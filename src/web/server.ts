import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ContextBuilder } from "../context/index.js";
import { isAbortError, type GrokProvider, type GrokUsage } from "../providers/grok.js";
import type { ImageProvider } from "../providers/images.js";
import type { SearchProvider } from "../providers/search.js";
import {
  runChatTurn,
  type ToolApprovalRequest,
  type ToolRuntimeEvent,
  type VerificationRuntimeStatus
} from "../runtime/chat.js";
import type { Session, SessionMessage, TaskMode } from "../runtime/session.js";
import { saveSession } from "../runtime/session-store.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import type { ToolRegistry } from "../tools/index.js";
import type { ToolApprovalDecision } from "../tools/types.js";
import type { AppConfig } from "../utils/config.js";
import { writeDebugLog } from "../utils/debug-log.js";

export interface StartWebServerOptions {
  config: AppConfig;
  contextBuilder: ContextBuilder;
  provider: GrokProvider;
  imageProvider: ImageProvider;
  registry: ToolRegistry;
  searchProvider: SearchProvider;
  session: Session;
  sessionPath: string;
  cwd: string;
  host: string;
  port: number;
}

export interface WebServerHandle {
  url: string;
  close(): Promise<void>;
}

interface PendingWebApproval {
  id: string;
  request: ToolApprovalRequest;
  selectedFiles: string[];
  resolve: (decision: ToolApprovalDecision) => void;
}

interface WebStateSnapshot {
  messages: readonly SessionMessage[];
  taskMode: TaskMode;
  cwd: string;
  busy: boolean;
  providerStatus: string;
  toolEvents: readonly ToolRuntimeEvent[];
  pendingApproval: SerializedApprovalRequest | null;
  usage?: GrokUsage;
  context?: ContextRuntimeMetadata;
  verification: VerificationRuntimeStatus;
  error?: string;
}

interface SerializedApprovalRequest {
  id: string;
  tool: string;
  permission: "passive" | "active";
  kind: "standard" | "patch";
  preview: string;
  selectedFiles: string[];
  args: unknown;
  risk?: ToolApprovalRequest["risk"];
  files?: string[];
  diff?: string;
  summary?: string;
}

interface JsonResponse {
  status?: number;
  body: unknown;
}

const STATIC_CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"]
]);

const MAX_JSON_BODY_BYTES = 1_000_000;

export async function startWebServer(options: StartWebServerOptions): Promise<WebServerHandle> {
  const runtime = new WebRuntime(options);
  let serverOrigin = "";

  const server = createServer((request, response) => {
    void handleRequest(request, response, runtime, () => serverOrigin);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : options.port;
  const displayHost = options.host === "::1" ? "[::1]" : options.host;
  const url = `http://${displayHost}:${actualPort}`;
  serverOrigin = url;

  return {
    url,
    close: () => new Promise((resolve, reject) => {
      runtime.closeClients();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    })
  };
}

class WebRuntime {
  private readonly clients = new Set<ServerResponse>();
  private busy = false;
  private error: string | undefined;
  private usage: GrokUsage | undefined;
  private context: ContextRuntimeMetadata | undefined;
  private verification: VerificationRuntimeStatus = { state: "not_run" };
  private lastSubmittedPrompt: string | undefined;
  private pendingApproval: PendingWebApproval | undefined;
  private currentAbortController: AbortController | undefined;
  private readonly toolEvents: ToolRuntimeEvent[] = [];

  constructor(private readonly options: StartWebServerOptions) {}

  snapshot(): WebStateSnapshot {
    return {
      messages: this.options.session.listMessages(),
      taskMode: this.options.session.getTaskMode(),
      cwd: this.options.cwd,
      busy: this.busy,
      providerStatus: this.providerStatus(),
      toolEvents: this.toolEvents,
      pendingApproval: this.pendingApproval ? serializeApproval(this.pendingApproval) : null,
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.context ? { context: this.context } : {}),
      verification: this.verification,
      ...(this.error ? { error: this.error } : {})
    };
  }

  addClient(response: ServerResponse): void {
    this.clients.add(response);
    response.on("close", () => {
      this.clients.delete(response);
    });
    sendSse(response, "state", this.snapshot());
  }

  closeClients(): void {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }

  async setMode(mode: TaskMode): Promise<JsonResponse> {
    if (this.busy) {
      return { status: 409, body: { error: "Cannot switch mode while a turn is running." } };
    }

    this.options.session.setTaskMode(mode);
    await saveSession(this.options.session, this.options.sessionPath);
    this.broadcastState();
    return { body: { ok: true, state: this.snapshot() } };
  }

  submit(prompt: string, retry: boolean): JsonResponse {
    if (this.busy) {
      return { status: 409, body: { error: "A chat turn is already running." } };
    }

    const trimmed = prompt.trim();
    if (!trimmed) {
      return { status: 400, body: { error: "Prompt is required." } };
    }

    this.lastSubmittedPrompt = trimmed;
    void this.runTurn(trimmed, retry);
    return { status: 202, body: { ok: true } };
  }

  retry(): JsonResponse {
    if (!this.lastSubmittedPrompt) {
      return { status: 400, body: { error: "Nothing to retry yet." } };
    }

    return this.submit(this.lastSubmittedPrompt, true);
  }

  approve(decision: ToolApprovalDecision & { id?: string }): JsonResponse {
    if (!this.pendingApproval) {
      return { status: 409, body: { error: "No approval is pending." } };
    }

    if (decision.id && decision.id !== this.pendingApproval.id) {
      return { status: 409, body: { error: `Approval id does not match pending request: ${this.pendingApproval.id}` } };
    }

    this.pendingApproval.resolve({
      approved: decision.approved,
      ...(decision.approvedFiles ? { approvedFiles: decision.approvedFiles } : {}),
      ...(decision.strongConfirmation ? { strongConfirmation: decision.strongConfirmation } : {})
    });
    this.pendingApproval = undefined;
    this.broadcastState();

    return { body: { ok: true } };
  }

  stop(): JsonResponse {
    if (!this.busy || !this.currentAbortController) {
      return { status: 409, body: { error: "No chat turn is running." } };
    }

    this.currentAbortController.abort();
    if (this.pendingApproval) {
      this.pendingApproval.resolve({ approved: false });
      this.pendingApproval = undefined;
    }
    this.error = "Turn stopped.";
    this.broadcast("error", { message: this.error });
    this.broadcastState();

    return { body: { ok: true } };
  }

  private async runTurn(prompt: string, retry: boolean): Promise<void> {
    this.busy = true;
    this.error = undefined;
    this.usage = undefined;
    this.context = undefined;
    this.verification = { state: "not_run" };
    this.currentAbortController = new AbortController();
    this.options.session.addUserMessage(prompt);
    await this.persistSession();
    this.broadcastState();
    void writeDebugLog(this.options.cwd, this.options.config.debug, retry ? "web.chat.retry" : "web.chat.submit", { prompt });

    try {
      const result = await runChatTurn({
        session: this.options.session,
        provider: this.options.provider,
        registry: this.options.registry,
        cwd: this.options.cwd,
        contextBuilder: this.options.contextBuilder,
        imageProvider: this.options.imageProvider,
        searchProvider: this.options.searchProvider,
        onSessionChange: async () => {
          await this.persistSession();
          this.broadcastState();
        },
        onDelta: (delta) => {
          this.broadcast("assistant_delta", { delta });
        },
        onToolEvent: (event) => {
          this.mergeToolEvent(event);
          this.broadcast("tool_event", event);
          this.broadcastState();
        },
        requestApproval: (request) => this.requestApproval(request),
        signal: this.currentAbortController.signal
      });

      this.usage = result.usage;
      this.context = result.context;
      this.verification = result.verification ?? { state: "not_run" };
      this.busy = false;
      await this.persistSession();
      this.broadcastState();
      this.broadcast("turn_complete", result);
      void writeDebugLog(this.options.cwd, this.options.config.debug, "web.chat.complete", {
        usage: result.usage,
        context: result.context
      });
    } catch (cause) {
      this.error = isAbortError(cause) ? "Turn stopped." : cause instanceof Error ? cause.message : String(cause);
      this.broadcast("error", { message: this.error });
      void writeDebugLog(this.options.cwd, this.options.config.debug, "web.chat.error", { message: this.error });
    } finally {
      this.pendingApproval = undefined;
      this.currentAbortController = undefined;
      if (this.busy) {
        this.busy = false;
        await this.persistSession();
        this.broadcastState();
      }
    }
  }

  private requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    return new Promise((resolve) => {
      this.pendingApproval = {
        id: request.call.id,
        request,
        selectedFiles: request.files ?? [],
        resolve
      };
      const serialized = serializeApproval(this.pendingApproval);
      this.broadcast("approval_requested", serialized);
      this.broadcastState();
    });
  }

  private mergeToolEvent(next: ToolRuntimeEvent): void {
    const index = this.toolEvents.findIndex((event) => event.id === next.id);
    if (index < 0) {
      this.toolEvents.push(next);
      return;
    }

    this.toolEvents[index] = next;
  }

  private broadcastState(): void {
    this.broadcast("state", this.snapshot());
  }

  private broadcast(type: string, payload: unknown): void {
    for (const client of this.clients) {
      sendSse(client, type, payload);
    }
  }

  private async persistSession(): Promise<void> {
    await saveSession(this.options.session, this.options.sessionPath);
  }

  private providerStatus(): string {
    if (this.options.config.mock) {
      return "mock mode";
    }

    return this.options.provider.canCallApi()
      ? `${this.options.config.model} via ${this.options.config.baseUrl} using ${this.options.config.apiKeySource ?? "API key"}`
      : "missing XAI_API_KEY";
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: WebRuntime,
  getOrigin: () => string
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", getOrigin() || "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      runtime.addClient(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      writeJson(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "GET" && isStaticPath(url.pathname)) {
      await serveStatic(response, url.pathname);
      return;
    }

    if (request.method === "POST") {
      const origin = request.headers.origin;
      if (origin && origin !== getOrigin()) {
        writeJson(response, 403, { error: "Forbidden origin." });
        return;
      }

      const body = await readJsonBody(request);
      const result = await handlePost(url.pathname, body, runtime);
      writeJson(response, result.status ?? 200, result.body);
      return;
    }

    if (isKnownPath(url.pathname)) {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }

    writeJson(response, 404, { error: "Not found." });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    writeJson(response, 500, { error: message });
  }
}

async function handlePost(pathname: string, body: unknown, runtime: WebRuntime): Promise<JsonResponse> {
  if (pathname === "/api/state" || pathname === "/api/events" || isStaticPath(pathname)) {
    return { status: 405, body: { error: "Method not allowed." } };
  }

  if (pathname === "/api/chat") {
    const prompt = isRecord(body) && typeof body.prompt === "string" ? body.prompt : "";
    return runtime.submit(prompt, false);
  }

  if (pathname === "/api/retry") {
    return runtime.retry();
  }

  if (pathname === "/api/stop") {
    return runtime.stop();
  }

  if (pathname === "/api/mode") {
    const mode = isRecord(body) && (body.mode === "plan" || body.mode === "act") ? body.mode : undefined;
    if (!mode) {
      return { status: 400, body: { error: "Mode must be plan or act." } };
    }

    return runtime.setMode(mode);
  }

  if (pathname === "/api/approval") {
    if (!isRecord(body) || typeof body.approved !== "boolean") {
      return { status: 400, body: { error: "Approval body requires an approved boolean." } };
    }

    const approvedFiles = Array.isArray(body.approvedFiles)
      ? body.approvedFiles.filter((value): value is string => typeof value === "string")
      : undefined;

    return runtime.approve({
      approved: body.approved,
      ...(typeof body.id === "string" ? { id: body.id } : {}),
      ...(body.strongConfirmation === true ? { strongConfirmation: true } : {}),
      ...(approvedFiles ? { approvedFiles } : {})
    });
  }

  return { status: 404, body: { error: "Not found." } };
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const staticPath = pathname === "/" ? "/index.html" : pathname;
  const fileName = path.basename(staticPath);
  const fullPath = path.join(staticRoot(), fileName);
  const contentType = STATIC_CONTENT_TYPES.get(path.extname(fileName)) ?? "application/octet-stream";

  try {
    const content = await readFile(fullPath);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    response.end(content);
  } catch {
    writeJson(response, 404, { error: "Not found." });
  }
}

function staticRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "static");
}

function isStaticPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/index.html" || pathname === "/app.js" || pathname === "/styles.css";
}

function isKnownPath(pathname: string): boolean {
  return isStaticPath(pathname) ||
    pathname === "/api/state" ||
    pathname === "/api/events" ||
    pathname === "/api/chat" ||
    pathname === "/api/retry" ||
    pathname === "/api/stop" ||
    pathname === "/api/mode" ||
    pathname === "/api/approval";
}

function sendSse(response: ServerResponse, type: string, payload: unknown): void {
  response.write(`event: ${type}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
  }

  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw) as unknown;
}

function serializeApproval(pending: PendingWebApproval): SerializedApprovalRequest {
  const request = pending.request;
  return {
    id: pending.id,
    tool: request.tool.name,
    permission: request.tool.permission,
    kind: request.kind,
    preview: request.preview,
    selectedFiles: pending.selectedFiles,
    args: request.call.parsedArguments,
    ...(request.risk ? { risk: request.risk } : {}),
    ...(request.files ? { files: request.files } : {}),
    ...(request.diff ? { diff: request.diff } : {}),
    ...(request.summary ? { summary: request.summary } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
