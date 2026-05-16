import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

import type { GrokStreamDelta } from "../src/providers/grok.js";
import { Session } from "../src/runtime/session.js";
import { defaultSessionPath } from "../src/runtime/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { toolSuccess, type Tool } from "../src/tools/types.js";
import { startWebServer, type StartWebServerOptions } from "../src/web/server.js";

class ScriptedProvider {
  readonly messages: ChatCompletionMessageParam[][] = [];
  readonly tools: ChatCompletionTool[][] = [];
  private readonly turns: GrokStreamDelta[][];

  constructor(turns: GrokStreamDelta[][] = []) {
    this.turns = turns;
  }

  canCallApi(): boolean {
    return true;
  }

  async *streamChat(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[] = []): AsyncGenerator<GrokStreamDelta> {
    this.messages.push(messages);
    this.tools.push(tools);
    const turn = this.turns.shift() ?? [];
    for (const event of turn) {
      yield event;
    }
  }

  async summarizeConversation(): Promise<{ ok: true; summary: string }> {
    return { ok: true, summary: "summary" };
  }
}

test("web server serves static assets and state", async () => {
  const handle = await startTestServer();
  try {
    const html = await fetch(`${handle.url}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /GrokCode/);

    const state = await fetch(`${handle.url}/api/state`);
    const body = await state.json() as { taskMode: string; busy: boolean; providerStatus: string };
    assert.equal(state.status, 200);
    assert.equal(body.taskMode, "act");
    assert.equal(body.busy, false);
    assert.equal(body.providerStatus, "mock mode");

    assert.equal((await fetch(`${handle.url}/missing`)).status, 404);
    assert.equal((await fetch(`${handle.url}/api/state`, { method: "POST", body: "{}" })).status, 405);
    assert.equal((await postJson(`${handle.url}/api/stop`, {})).status, 409);
  } finally {
    await handle.close();
  }
});

test("web chat streams assistant deltas, tool events, and persists session", async () => {
  const registry = new ToolRegistry();
  registry.register(createTool("read_test", "passive", async () => toolSuccess("read_test", { value: "ok" })));
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "tool_1", name: "read_test", arguments: "{}" }] }],
    [{ type: "content", content: "done" }]
  ]);
  const handle = await startTestServer({ provider, registry });
  const events = await connectEvents(handle.url);

  try {
    const response = await postJson(`${handle.url}/api/chat`, { prompt: "use tool" });
    assert.equal(response.status, 202);

    const toolEvent = await readEvent(events, "tool_event");
    assert.equal(toolEvent.tool, "read_test");
    assert.equal(toolEvent.status, "requested");

    const delta = await readEvent(events, "assistant_delta");
    assert.equal(delta.delta, "done");

    const complete = await readEvent(events, "turn_complete");
    assert.equal(complete.content, "done");

    const rawSession = await readFile(handle.sessionPath, "utf8");
    assert.match(rawSession, /use tool/);
    assert.match(rawSession, /done/);
  } finally {
    events.cancel();
    await handle.close();
  }
});

test("web chat rejects concurrent submissions while busy", async () => {
  const blocker = createDeferred<void>();
  const provider = {
    canCallApi: () => true,
    async *streamChat(): AsyncGenerator<GrokStreamDelta> {
      await blocker.promise;
      yield { type: "content", content: "done" };
    },
    async summarizeConversation() {
      return { ok: true, summary: "summary" };
    }
  };
  const handle = await startTestServer({ provider });

  try {
    assert.equal((await postJson(`${handle.url}/api/chat`, { prompt: "first" })).status, 202);
    assert.equal((await postJson(`${handle.url}/api/chat`, { prompt: "second" })).status, 409);
    blocker.resolve();
    await waitForIdle(handle.url);
  } finally {
    await handle.close();
  }
});

test("web stop aborts a running model stream", async () => {
  let signalSeen: AbortSignal | undefined;
  const provider = {
    canCallApi: () => true,
    async *streamChat(_messages: ChatCompletionMessageParam[], _tools: ChatCompletionTool[], options?: { signal?: AbortSignal }): AsyncGenerator<GrokStreamDelta> {
      signalSeen = options?.signal;
      yield { type: "content", content: "partial" };
      await waitForAbort(options?.signal);
      throw createAbortError();
    },
    async summarizeConversation() {
      return { ok: true, summary: "summary" };
    }
  };
  const handle = await startTestServer({ provider });
  const events = await connectEvents(handle.url);

  try {
    assert.equal((await postJson(`${handle.url}/api/chat`, { prompt: "long model" })).status, 202);
    const delta = await readEvent(events, "assistant_delta");
    assert.equal(delta.delta, "partial");
    assert.equal((await postJson(`${handle.url}/api/stop`, {})).status, 200);
    const stopped = await readEvent(events, "error");
    assert.equal(stopped.message, "Turn stopped.");
    await waitForIdle(handle.url);
    assert.equal(signalSeen?.aborted, true);
  } finally {
    events.cancel();
    await handle.close();
  }
});

test("web stop passes abort signal to running tools", async () => {
  let toolSignal: AbortSignal | undefined;
  const registry = new ToolRegistry();
  registry.register(createTool("slow_tool", "passive", async (_args, context) => {
    toolSignal = context.signal;
    await waitForAbort(context.signal);
    return toolSuccess("slow_tool", {});
  }));
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "slow_1", name: "slow_tool", arguments: "{}" }] }],
    [{ type: "content", content: "unreached" }]
  ]);
  const handle = await startTestServer({ provider, registry });
  const events = await connectEvents(handle.url);

  try {
    assert.equal((await postJson(`${handle.url}/api/chat`, { prompt: "slow tool" })).status, 202);
    const running = await readToolEvent(events, "running");
    assert.equal(running.tool, "slow_tool");
    assert.equal((await postJson(`${handle.url}/api/stop`, {})).status, 200);
    const stopped = await readEvent(events, "error");
    assert.equal(stopped.message, "Turn stopped.");
    await waitForIdle(handle.url);
    assert.equal(toolSignal?.aborted, true);
  } finally {
    events.cancel();
    await handle.close();
  }
});

test("web approval denial returns approval_denied", async () => {
  const registry = new ToolRegistry();
  registry.register(createTool("active_test", "active", async () => toolSuccess("active_test", { value: "ran" })));
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "active_1", name: "active_test", arguments: "{}" }] }],
    [{ type: "content", content: "denied handled" }]
  ]);
  const handle = await startTestServer({ provider, registry });
  const events = await connectEvents(handle.url);

  try {
    assert.equal((await postJson(`${handle.url}/api/chat`, { prompt: "try active" })).status, 202);
    const approval = await readEvent(events, "approval_requested");
    assert.equal(approval.id, "active_1");
    assert.equal(approval.tool, "active_test");

    assert.equal((await postJson(`${handle.url}/api/approval`, { id: "active_1", approved: false })).status, 200);
    await readEvent(events, "turn_complete");

    const rawSession = await readFile(handle.sessionPath, "utf8");
    assert.match(rawSession, /approval_denied/);
  } finally {
    events.cancel();
    await handle.close();
  }
});

test("web approval requires strong confirmation for destructive shell commands", async () => {
  let executed = false;
  const registry = new ToolRegistry();
  registry.register(createTool("run_shell", "active", async () => {
    executed = true;
    return toolSuccess("run_shell", {});
  }));
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "shell_1", name: "run_shell", arguments: "{\"command\":\"rm -rf dist\"}" }] }],
    [{ type: "content", content: "blocked" }]
  ]);
  const handle = await startTestServer({ provider, registry });
  const events = await connectEvents(handle.url);

  try {
    assert.equal((await postJson(`${handle.url}/api/chat`, { prompt: "run risky" })).status, 202);
    const approval = await readEvent(events, "approval_requested");
    assert.equal(approval.risk.requiresStrongConfirmation, true);
    assert.equal((await postJson(`${handle.url}/api/approval`, { id: "shell_1", approved: true })).status, 200);
    await readEvent(events, "turn_complete");

    const rawSession = await readFile(handle.sessionPath, "utf8");
    assert.equal(executed, false);
    assert.match(rawSession, /strong_confirmation_required/);
  } finally {
    events.cancel();
    await handle.close();
  }
});

test("web patch approval passes selected files", async () => {
  let approvedFiles: string[] | undefined;
  const registry = new ToolRegistry();
  registry.register(createTool("apply_patch", "active", async (_args, context) => {
    approvedFiles = context.approval?.approvedFiles;
    return toolSuccess("apply_patch", { appliedFiles: approvedFiles ?? [] });
  }));
  const patch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "--- a/b.txt",
    "+++ b/b.txt",
    "@@ -1,1 +1,1 @@",
    "-red",
    "+blue"
  ].join("\n");
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "patch_1", name: "apply_patch", arguments: JSON.stringify({ patch }) }] }],
    [{ type: "content", content: "patched" }]
  ]);
  const handle = await startTestServer({ provider, registry });
  const events = await connectEvents(handle.url);

  try {
    assert.equal((await postJson(`${handle.url}/api/chat`, { prompt: "patch" })).status, 202);
    const approval = await readEvent(events, "approval_requested");
    assert.deepEqual(approval.files, ["a.txt", "b.txt"]);
    assert.equal((await postJson(`${handle.url}/api/approval`, {
      id: "patch_1",
      approved: true,
      approvedFiles: ["a.txt"]
    })).status, 200);
    await readEvent(events, "turn_complete");
    assert.deepEqual(approvedFiles, ["a.txt"]);
  } finally {
    events.cancel();
    await handle.close();
  }
});

async function startTestServer(overrides: Partial<StartWebServerOptions> = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-web-"));
  const sessionPath = defaultSessionPath(cwd);
  const handle = await startWebServer({
    config: {
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.3",
      imageModel: "grok-imagine-image-quality",
      mock: true
    },
    contextBuilder: {
      async buildContext() {
        return {
          prompt: "<repo_context>\nempty",
          items: [],
          estimatedTokens: 1,
          truncated: false
        };
      }
    },
    provider: new ScriptedProvider() as never,
    imageProvider: {} as never,
    registry: new ToolRegistry(),
    searchProvider: {} as never,
    session: new Session(),
    sessionPath,
    cwd,
    host: "127.0.0.1",
    port: 0,
    ...overrides
  });

  return {
    ...handle,
    sessionPath
  };
}

function createTool(name: string, permission: "passive" | "active", execute: Tool["execute"]): Tool {
  return {
    name,
    description: name,
    permission,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: true
    },
    execute
  };
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function connectEvents(url: string): Promise<{
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel(): void;
  buffer: string;
  events: Array<{ type: string; data: any }>;
}> {
  const response = await fetch(`${url}/api/events`);
  assert.equal(response.status, 200);
  assert.ok(response.body);
  const reader = response.body.getReader();
  return {
    buffer: "",
    events: [],
    read: () => reader.read(),
    cancel: () => void reader.cancel()
  };
}

async function readEvent(stream: Awaited<ReturnType<typeof connectEvents>>, expectedType: string): Promise<any> {
  const decoder = new TextDecoder();
  const timeoutAt = Date.now() + 3_000;

  while (Date.now() < timeoutAt) {
    stream.events.push(...parseBufferedEvents(stream));
    const index = stream.events.findIndex((event) => event.type === expectedType);
    if (index >= 0) {
      const [found] = stream.events.splice(index, 1);
      return found?.data;
    }

    const read = await stream.read();
    if (read.done) {
      break;
    }

    stream.buffer += decoder.decode(read.value, { stream: true });
  }

  throw new Error(`Timed out waiting for SSE event: ${expectedType}`);
}

async function readToolEvent(stream: Awaited<ReturnType<typeof connectEvents>>, status: string): Promise<any> {
  const timeoutAt = Date.now() + 3_000;

  while (Date.now() < timeoutAt) {
    const event = await readEvent(stream, "tool_event");
    if (event.status === status) {
      return event;
    }
  }

  throw new Error(`Timed out waiting for tool event status: ${status}`);
}

function parseBufferedEvents(stream: { buffer: string }): Array<{ type: string; data: any }> {
  const chunks = stream.buffer.split("\n\n");
  stream.buffer = chunks.pop() ?? "";

  return chunks.map((chunk) => {
    const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "message";
    const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? "{}";
    return {
      type,
      data: JSON.parse(data)
    };
  });
}

async function waitForIdle(url: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await fetch(`${url}/api/state`).then((response) => response.json()) as { busy: boolean };
    if (!state.busy) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for idle web server.");
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error("Operation aborted.");
  error.name = "AbortError";
  return error;
}
