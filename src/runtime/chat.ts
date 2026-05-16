import type { GrokProvider, GrokUsage } from "../providers/grok.js";
import type { Session } from "./session.js";
import type { ContextBuilder } from "../context/index.js";
import type { BuiltContext } from "../context/types.js";
import { createPatchPreview } from "../editing/engine.js";
import {
  type ContextRuntimeMetadata,
  type ConversationSummarizer,
  type SummarizationOptions,
  summarizeSessionIfNeeded
} from "./summarization.js";
import { runFileCommand } from "../tools/process.js";
import { classifyShellCommand, type ShellRisk } from "../tools/shell-risk.js";
import { parseToolArguments } from "../tools/args.js";
import type { GrokStreamOptions } from "../providers/grok.js";
import type {
  ParsedToolCallRequest,
  Tool,
  ToolCallRequest,
  ToolExecutionResult,
  ToolRegistry,
  ImageProviderLike,
  SearchProviderLike
} from "../tools/index.js";
import { toolFailure, type ToolApprovalDecision } from "../tools/types.js";

export interface ChatTurnResult {
  content: string;
  usage?: GrokUsage;
  context?: ContextRuntimeMetadata;
  verification?: VerificationRuntimeStatus;
}

export type VerificationRuntimeStatus =
  | { state: "not_run" }
  | { state: "passed"; commandCount: number; elapsedMs?: number }
  | { state: "failed"; command: string; summary: string; elapsedMs?: number };

export type ToolEventStatus = "requested" | "approval_requested" | "approved" | "denied" | "running" | "completed";

export interface ToolRuntimeEvent {
  id: string;
  tool: string;
  permission?: "passive" | "active";
  status: ToolEventStatus;
  args?: unknown;
  result?: ToolExecutionResult;
}

export interface ToolApprovalRequest {
  call: ParsedToolCallRequest;
  tool: Tool;
  preview: string;
  kind: "standard" | "patch";
  risk?: ShellRisk;
  files?: string[];
  diff?: string;
  summary?: string;
}

export interface RunChatTurnOptions {
  session: Session;
  provider: Pick<GrokProvider, "streamChat"> & Partial<ConversationSummarizer>;
  registry: ToolRegistry;
  cwd: string;
  onDelta: (delta: string) => void;
  onSessionChange?: (session: Session) => void | Promise<void>;
  onToolEvent?: (event: ToolRuntimeEvent) => void;
  requestApproval: (request: ToolApprovalRequest) => Promise<boolean | ToolApprovalDecision>;
  contextBuilder?: ContextBuilder;
  imageProvider?: ImageProviderLike;
  searchProvider?: SearchProviderLike;
  maxToolRounds?: number;
  summarization?: Partial<SummarizationOptions>;
  signal?: AbortSignal;
}

export async function runChatTurn(options: RunChatTurnOptions): Promise<ChatTurnResult> {
  throwIfAborted(options.signal);
  const maxToolRounds = options.maxToolRounds ?? 6;
  let usage: GrokUsage | undefined;
  let verification: VerificationRuntimeStatus = { state: "not_run" };
  const turnContext = await buildTurnContext(options);
  const summaryMetadata = await summarizeSessionIfNeeded(
    options.session,
    options.provider.summarizeConversation ? options.provider as ConversationSummarizer : undefined,
    options.summarization
  );

  if (summaryMetadata.summarized) {
    await notifySessionChange(options);
  }
  throwIfAborted(options.signal);
  const contextMetadata: ContextRuntimeMetadata = {
    ...(turnContext
      ? {
          repoContext: {
            estimatedTokens: turnContext.estimatedTokens,
            truncated: turnContext.truncated,
            itemCount: turnContext.items.length
          }
        }
      : {}),
    conversationSummary: summaryMetadata
  };

  for (let round = 0; round < maxToolRounds; round += 1) {
    throwIfAborted(options.signal);
    let content = "";
    let toolCalls: ToolCallRequest[] = [];

    for await (const event of options.provider.streamChat(
      options.session.toChatMessages(turnContext?.prompt),
      options.registry.toChatCompletionTools({ includeActive: options.session.getTaskMode() !== "plan" }),
      { signal: options.signal } satisfies GrokStreamOptions
    )) {
      throwIfAborted(options.signal);
      if (event.type === "content" && event.content) {
        content += event.content;
        options.onDelta(event.content);
      }

      if (event.type === "usage") {
        usage = event.usage;
      }

      if (event.type === "tool_calls" && event.toolCalls) {
        toolCalls = [...toolCalls, ...event.toolCalls];
      }
    }

    if (toolCalls.length === 0) {
      options.session.addAssistantMessage(content);
      await notifySessionChange(options);
      return {
        content,
        usage,
        context: contextMetadata,
        verification
      };
    }

    options.session.addAssistantMessage(content, toolCalls);
    await notifySessionChange(options);

    for (const toolCall of toolCalls) {
      throwIfAborted(options.signal);
      const result = await executeToolCall(toolCall, options);
      verification = updateVerificationStatus(verification, toolCall.name, result);
      options.session.addToolMessage(toolCall.id, JSON.stringify(result));
      await notifySessionChange(options);
    }
  }

  const content = "Stopped after reaching the tool round limit.";
  options.onDelta(content);
  options.session.addAssistantMessage(content);
  await notifySessionChange(options);

  return {
    content,
    usage,
    context: contextMetadata,
    verification
  };
}

async function notifySessionChange(options: RunChatTurnOptions): Promise<void> {
  await options.onSessionChange?.(options.session);
}

async function buildTurnContext(options: RunChatTurnOptions): Promise<BuiltContext | undefined> {
  if (!options.contextBuilder) {
    return undefined;
  }

  const latestUserMessage = [...options.session.listMessages()]
    .reverse()
    .find((message) => message.role === "user")
    ?.content;

  if (!latestUserMessage) {
    return undefined;
  }

  const context = await options.contextBuilder.buildContext(options.cwd, latestUserMessage);
  return context;
}

async function executeToolCall(
  call: ToolCallRequest,
  options: RunChatTurnOptions
): Promise<ToolExecutionResult> {
  throwIfAborted(options.signal);
  const parsed = parseToolArguments(call.arguments);

  if (!parsed.ok) {
    const result = toolFailure(call.name, "invalid_arguments", parsed.message);
    options.onToolEvent?.({
      id: call.id,
      tool: call.name,
      status: "completed",
      result
    });
    return result;
  }

  const parsedCall: ParsedToolCallRequest = {
    ...call,
    parsedArguments: parsed.value
  };

  const tool = options.registry.get(call.name);

  if (!tool) {
    const result = toolFailure(call.name, "unknown_tool", `Unknown tool: ${call.name}`);
    options.onToolEvent?.({
      id: call.id,
      tool: call.name,
      status: "completed",
      args: parsed.value,
      result
    });
    return result;
  }

  options.onToolEvent?.({
    id: call.id,
    tool: tool.name,
    permission: tool.permission,
    status: "requested",
    args: parsed.value
  });

  let approval: ToolApprovalDecision | undefined;

  if (options.session.getTaskMode() === "plan" && tool.permission === "active") {
    const result = toolFailure(tool.name, "plan_mode_blocked", "Plan mode blocks active tool execution. Switch to /act to approve implementation tools.");
    options.onToolEvent?.({
      id: call.id,
      tool: tool.name,
      permission: tool.permission,
      status: "denied",
      args: parsed.value,
      result
    });
    return result;
  }

  if (tool.permission === "active") {
    const approvalRequest = await createApprovalRequest(parsedCall, tool, parsed.value, options.cwd);
    options.onToolEvent?.({
      id: call.id,
      tool: tool.name,
      permission: tool.permission,
      status: "approval_requested",
      args: parsed.value
    });

    approval = normalizeApprovalDecision(await waitForApproval(approvalRequest, options));
    throwIfAborted(options.signal);

    if (!approval.approved) {
      const result = toolFailure(tool.name, "approval_denied", "User denied tool execution.");
      options.onToolEvent?.({
        id: call.id,
        tool: tool.name,
        permission: tool.permission,
        status: "denied",
        args: parsed.value,
        result
      });
      return result;
    }

    if (approvalRequest.risk?.requiresStrongConfirmation && !approval.strongConfirmation) {
      const result = toolFailure(tool.name, "strong_confirmation_required", "This shell command requires strong confirmation with !.");
      options.onToolEvent?.({
        id: call.id,
        tool: tool.name,
        permission: tool.permission,
        status: "denied",
        args: parsed.value,
        result
      });
      return result;
    }

    options.onToolEvent?.({
      id: call.id,
      tool: tool.name,
      permission: tool.permission,
      status: "approved",
      args: parsed.value
    });
  }

  options.onToolEvent?.({
    id: call.id,
    tool: tool.name,
    permission: tool.permission,
    status: "running",
    args: parsed.value
  });

  const result = await tool.execute(parsed.value, {
    cwd: options.cwd,
    approval,
    imageProvider: options.imageProvider,
    searchProvider: options.searchProvider,
    signal: options.signal
  });

  options.onToolEvent?.({
    id: call.id,
    tool: tool.name,
    permission: tool.permission,
    status: "completed",
    args: parsed.value,
    result
  });

  return result;
}

function waitForApproval(
  request: ToolApprovalRequest,
  options: RunChatTurnOptions
): Promise<boolean | ToolApprovalDecision> {
  if (!options.signal) {
    return options.requestApproval(request);
  }

  return Promise.race([
    options.requestApproval(request),
    waitForAbort(options.signal)
  ]);
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    signal.addEventListener("abort", () => reject(createAbortError()), { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error("Operation aborted.");
  error.name = "AbortError";
  return error;
}

async function createApprovalRequest(call: ParsedToolCallRequest, tool: Tool, args: unknown, cwd: string): Promise<ToolApprovalRequest> {
  if (tool.name === "apply_patch") {
    const patchPreview = createPatchPreview(args);

    if (patchPreview) {
      return {
        call,
        tool,
        kind: "patch",
        preview: patchPreview.summary ?? `Patch changes ${patchPreview.files.length} file(s).`,
        files: patchPreview.files,
        diff: patchPreview.diff,
        summary: patchPreview.summary
      };
    }
  }

  if (tool.name === "git_restore") {
    return createGitRestoreApprovalRequest(call, tool, args, cwd);
  }

  const risk = shellRiskForApproval(tool.name, args);

  return {
    call,
    tool,
    kind: "standard",
    preview: createApprovalPreview(tool.name, args),
    ...(risk ? { risk } : {})
  };
}

async function createGitRestoreApprovalRequest(
  call: ParsedToolCallRequest,
  tool: Tool,
  args: unknown,
  cwd: string
): Promise<ToolApprovalRequest> {
  const record = typeof args === "object" && args !== null ? args as Record<string, unknown> : {};
  const rawPaths = record.paths;
  const paths = Array.isArray(rawPaths)
    ? rawPaths.filter((value): value is string => typeof value === "string")
    : [];
  const staged = record.staged === true;
  const source = typeof record.source === "string"
    ? record.source
    : "HEAD";
  const diffArgs = staged
    ? ["diff", "--staged", "--", ...paths]
    : ["diff", "--", ...paths];
  const diff = paths.length > 0 ? await runFileCommand("git", diffArgs, { cwd, timeoutMs: 10_000 }) : undefined;
  const mode = staged ? "unstage index entries" : `restore worktree from ${source}`;

  return {
    call,
    tool,
    kind: "standard",
    preview: [
      `Mode: ${mode}`,
      `Paths: ${paths.length > 0 ? paths.join(", ") : "(none)"}`,
      diff?.stdout.trim() ? `\n${diff.stdout.trimEnd()}` : "\n(no diff preview)"
    ].join("\n")
  };
}

function shellRiskForApproval(toolName: string, args: unknown): ShellRisk | undefined {
  if (toolName !== "run_shell" || typeof args !== "object" || args === null) {
    return undefined;
  }

  const command = (args as Record<string, unknown>).command;
  return typeof command === "string" ? classifyShellCommand(command) : undefined;
}

function createApprovalPreview(toolName: string, args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return toolName;
  }

  const record = args as Record<string, unknown>;

  if (toolName === "run_shell" && typeof record.command === "string") {
    return record.command;
  }

  if (toolName === "write_file" && typeof record.path === "string") {
    const content = typeof record.content === "string" ? record.content : "";
    return `${record.path} (${Buffer.byteLength(content, "utf8")} bytes)`;
  }

  if (toolName === "create_directory" && typeof record.path === "string") {
    return `Create directory: ${record.path}`;
  }

  if (toolName === "copy_file" && typeof record.source === "string" && typeof record.destination === "string") {
    return `Copy ${record.source} -> ${record.destination}${record.overwrite === true ? " (overwrite allowed)" : ""}`;
  }

  if (toolName === "move_file" && typeof record.source === "string" && typeof record.destination === "string") {
    return `Move ${record.source} -> ${record.destination}${record.overwrite === true ? " (overwrite allowed)" : ""}`;
  }

  if (toolName === "delete_file" && typeof record.path === "string") {
    return `Soft-delete ${record.path} into .workspace/trash`;
  }

  if (toolName === "git_commit" && typeof record.message === "string") {
    return record.message;
  }

  if (toolName === "verify_changes") {
    const commands = Array.isArray(record.commands)
      ? record.commands.filter((command): command is string => typeof command === "string")
      : [];
    const reason = typeof record.reason === "string" ? `${record.reason}\n` : "";
    return commands.length > 0
      ? `${reason}${commands.join("\n")}`
      : `${reason}Run detected verification commands.`;
  }

  if (toolName === "image_generate" && typeof record.prompt === "string") {
    const count = typeof record.count === "number" ? record.count : 1;
    const details = [
      `${count} image${count === 1 ? "" : "s"}`,
      typeof record.aspectRatio === "string" ? record.aspectRatio : undefined,
      typeof record.resolution === "string" ? record.resolution : undefined
    ].filter(Boolean);

    return `${record.prompt}\n${details.join(", ")} -> .workspace/images`;
  }

  if (toolName === "image_edit" && typeof record.prompt === "string") {
    const images = Array.isArray(record.images) ? record.images.length : 0;
    const details = [
      `${images} source image${images === 1 ? "" : "s"}`,
      typeof record.aspectRatio === "string" ? record.aspectRatio : undefined,
      typeof record.resolution === "string" ? record.resolution : undefined
    ].filter(Boolean);

    return `${record.prompt}\n${details.join(", ")} -> .workspace/images`;
  }

  if (toolName === "capture_clipboard_image") {
    return "Capture the current Windows clipboard image and save it under .workspace/images.";
  }

  return JSON.stringify(args);
}

function normalizeApprovalDecision(decision: boolean | ToolApprovalDecision): ToolApprovalDecision {
  if (typeof decision === "boolean") {
    return {
      approved: decision
    };
  }

  return decision;
}

function updateVerificationStatus(
  current: VerificationRuntimeStatus,
  toolName: string,
  result: ToolExecutionResult
): VerificationRuntimeStatus {
  if (toolName !== "verify_changes") {
    return current;
  }

  const output = isRecord(result.output) ? result.output : {};
  const metadata = isRecord(result.metadata) ? result.metadata : {};
  const source = result.ok ? output : metadata;
  const elapsedMs = typeof source.elapsedMs === "number" ? source.elapsedMs : undefined;

  if (result.ok) {
    const commandCount = Array.isArray(source.commands) ? source.commands.length : 0;
    return {
      state: "passed",
      commandCount,
      ...(elapsedMs !== undefined ? { elapsedMs } : {})
    };
  }

  if (result.error?.code === "verification_failed") {
    return {
      state: "failed",
      command: typeof source.failedCommand === "string" ? source.failedCommand : "verification",
      summary: typeof source.failureSummary === "string" ? source.failureSummary : result.error.message,
      ...(elapsedMs !== undefined ? { elapsedMs } : {})
    };
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
