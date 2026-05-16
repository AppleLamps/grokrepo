import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

import type { ContextBuilder } from "../src/context/index.js";
import type { GrokStreamDelta } from "../src/providers/grok.js";
import { runChatTurn } from "../src/runtime/chat.js";
import { parseHeadlessArgs, renderHeadlessJson, runHeadlessTurn } from "../src/runtime/headless.js";
import { Session } from "../src/runtime/session.js";
import type { ConversationSummarizationInput, SummarizationResult } from "../src/runtime/summarization.js";
import { runFileCommand } from "../src/tools/process.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { toolFailure, toolSuccess, type ImageProviderLike, type SearchProviderLike, type Tool } from "../src/tools/types.js";

class ScriptedProvider {
  readonly messages: ChatCompletionMessageParam[][] = [];
  readonly tools: ChatCompletionTool[][] = [];
  readonly summaryInputs: ConversationSummarizationInput[] = [];
  private readonly turns: GrokStreamDelta[][];
  private readonly summaryResult?: SummarizationResult;

  constructor(turns: GrokStreamDelta[][], summaryResult?: SummarizationResult) {
    this.turns = turns;
    this.summaryResult = summaryResult;
  }

  async *streamChat(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[] = []): AsyncGenerator<GrokStreamDelta> {
    this.messages.push(messages);
    this.tools.push(tools);
    const nextTurn = this.turns.shift() ?? [];

    for (const event of nextTurn) {
      yield event;
    }
  }

  async summarizeConversation(input: ConversationSummarizationInput): Promise<SummarizationResult> {
    this.summaryInputs.push(input);
    return this.summaryResult ?? { ok: true, summary: "summarized older turns" };
  }
}

test("passive tool call executes and final response continues", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  let executed = false;

  registry.register(createTool("read_test", "passive", async () => {
    executed = true;
    return toolSuccess("read_test", { value: "ok" });
  }));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "read_test", arguments: "{}" }] }],
    [{ type: "content", content: "final" }]
  ]);
  const session = new Session();
  session.addUserMessage("use the tool");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(executed, true);
  assert.equal(result.content, "final");
  assert.equal(provider.messages.length, 2);
  assert.equal(session.listMessages().some((message) => message.role === "tool"), true);
});

test("passive tool turn emits session change notifications for assistant and tool messages", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const messageCounts: number[] = [];

  registry.register(createTool("read_test", "passive", async () => toolSuccess("read_test", { value: "ok" })));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "read_test", arguments: "{}" }] }],
    [{ type: "content", content: "final" }]
  ]);
  const session = new Session();
  session.addUserMessage("use the tool");

  await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    onSessionChange: (changedSession) => messageCounts.push(changedSession.listMessages().length),
    requestApproval: async () => false
  });

  assert.deepEqual(messageCounts, [3, 4, 5]);
});

test("passive tool emits requested, running, and completed lifecycle events", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const events: string[] = [];

  registry.register(createTool("read_test", "passive", async () => toolSuccess("read_test", { value: "ok" })));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "read_test", arguments: "{}" }] }],
    [{ type: "content", content: "final" }]
  ]);
  const session = new Session();
  session.addUserMessage("use the tool");

  await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    onToolEvent: (event) => events.push(`${event.id}:${event.status}:${event.result?.ok ?? ""}`),
    requestApproval: async () => false
  });

  assert.deepEqual(events, [
    "call_1:requested:",
    "call_1:running:",
    "call_1:completed:true"
  ]);
});

test("active tool denial returns a denial tool result", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  let executed = false;

  registry.register(createTool("active_test", "active", async () => {
    executed = true;
    return toolSuccess("active_test", { value: "ran" });
  }));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "active_test", arguments: "{}" }] }],
    [{ type: "content", content: "denied handled" }]
  ]);
  const session = new Session();
  session.addUserMessage("try active tool");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  const toolMessage = session.listMessages().find((message) => message.role === "tool");

  assert.equal(executed, false);
  assert.equal(result.content, "denied handled");
  assert.ok(toolMessage);
  assert.match(toolMessage.content, /approval_denied/);
});

test("active tool denial emits approval and denied lifecycle events", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const events: string[] = [];

  registry.register(createTool("active_test", "active", async () => toolSuccess("active_test", { value: "ran" })));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "active_test", arguments: "{}" }] }],
    [{ type: "content", content: "denied handled" }]
  ]);
  const session = new Session();
  session.addUserMessage("try active tool");

  await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    onToolEvent: (event) => events.push(`${event.id}:${event.status}:${event.result?.ok ?? ""}`),
    requestApproval: async () => false
  });

  assert.deepEqual(events, [
    "call_1:requested:",
    "call_1:approval_requested:",
    "call_1:denied:false"
  ]);
});

test("active tool approval executes exactly once", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  let executions = 0;

  registry.register(createTool("active_test", "active", async () => {
    executions += 1;
    return toolSuccess("active_test", { value: "ran" });
  }));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "active_test", arguments: "{}" }] }],
    [{ type: "content", content: "approved handled" }]
  ]);
  const session = new Session();
  session.addUserMessage("approve active tool");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => true
  });

  assert.equal(executions, 1);
  assert.equal(result.content, "approved handled");
});

test("plan mode exposes only passive tool schemas", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  registry.register(createTool("read_test", "passive", async () => toolSuccess("read_test", {})));
  registry.register(createTool("active_test", "active", async () => toolSuccess("active_test", {})));
  const provider = new ScriptedProvider([[{ type: "content", content: "planned" }]]);
  const session = new Session();
  session.setTaskMode("plan");
  session.addUserMessage("plan a change");

  await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  const toolNames = provider.tools[0]?.map((tool) => tool.function.name);
  assert.deepEqual(toolNames, ["read_test"]);
  assert.match(String(provider.messages[0]?.[1]?.content), /mode: plan/);
});

test("plan mode blocks active tool calls without approval or execution", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  let approvals = 0;
  let executions = 0;
  const events: string[] = [];

  registry.register(createTool("active_test", "active", async () => {
    executions += 1;
    return toolSuccess("active_test", { value: "ran" });
  }));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "active_test", arguments: "{}" }] }],
    [{ type: "content", content: "blocked handled" }]
  ]);
  const session = new Session();
  session.setTaskMode("plan");
  session.addUserMessage("try implementation");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    onToolEvent: (event) => events.push(`${event.tool}:${event.status}:${event.result?.error?.code ?? ""}`),
    requestApproval: async () => {
      approvals += 1;
      return true;
    }
  });

  const toolMessage = session.listMessages().find((message) => message.role === "tool")?.content ?? "";
  assert.equal(result.content, "blocked handled");
  assert.equal(approvals, 0);
  assert.equal(executions, 0);
  assert.match(toolMessage, /plan_mode_blocked/);
  assert.deepEqual(events, ["active_test:requested:", "active_test:denied:plan_mode_blocked"]);
});

test("multiple tool calls execute in request order", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const order: string[] = [];

  registry.register(createTool("first_tool", "passive", async () => {
    order.push("first_tool");
    return toolSuccess("first_tool", {});
  }));
  registry.register(createTool("second_tool", "passive", async () => {
    order.push("second_tool");
    return toolSuccess("second_tool", {});
  }));

  const provider = new ScriptedProvider([
    [
      { type: "tool_calls", toolCalls: [{ id: "call_1", name: "first_tool", arguments: "{}" }] },
      { type: "tool_calls", toolCalls: [{ id: "call_2", name: "second_tool", arguments: "{}" }] }
    ],
    [{ type: "content", content: "done" }]
  ]);
  const session = new Session();
  session.addUserMessage("use both");

  await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.deepEqual(order, ["first_tool", "second_tool"]);
});

test("tool loop stops at configured max round limit", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();

  registry.register(createTool("loop_tool", "passive", async () => toolSuccess("loop_tool", {})));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "loop_tool", arguments: "{}" }] }],
    [{ type: "tool_calls", toolCalls: [{ id: "call_2", name: "loop_tool", arguments: "{}" }] }]
  ]);
  const session = new Session();
  session.addUserMessage("loop");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false,
    maxToolRounds: 1
  });

  assert.equal(result.content, "Stopped after reaching the tool round limit.");
  assert.equal(provider.messages.length, 1);
});

test("session task mode persists and old sessions default to act", () => {
  const session = new Session();
  assert.equal(session.getTaskMode(), "act");

  session.setTaskMode("plan");
  const restored = new Session(session.serialize());
  const oldRestored = new Session({
    id: "old_session",
    messages: session.serialize().messages,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });

  assert.equal(restored.getTaskMode(), "plan");
  assert.equal(restored.serialize().taskMode, "plan");
  assert.equal(oldRestored.getTaskMode(), "act");
});

test("headless args distinguish interactive and one-shot modes", () => {
  assert.deepEqual(parseHeadlessArgs([]), { mode: "interactive" });
  assert.deepEqual(parseHeadlessArgs(["--print", "explain", "repo"]), {
    mode: "headless",
    options: {
      prompt: "explain repo",
      output: "plain",
      yesSafe: false
    }
  });
  assert.deepEqual(parseHeadlessArgs(["--json", "--yes-safe", "run tests"]), {
    mode: "headless",
    options: {
      prompt: "run tests",
      output: "json",
      yesSafe: true
    }
  });
  assert.equal(parseHeadlessArgs(["--json"]).error, "Headless mode requires a prompt argument.");
});

test("headless mode denies active tools by default and exits with code 2", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  let executions = 0;

  registry.register(createTool("active_test", "active", async () => {
    executions += 1;
    return toolSuccess("active_test", {});
  }));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "active_test", arguments: "{}" }] }],
    [{ type: "content", content: "denied" }]
  ]);

  const result = await runHeadlessTurn({
    session: new Session(),
    provider,
    registry,
    cwd,
    prompt: "try active"
  });

  assert.equal(result.content, "denied");
  assert.equal(result.exitCode, 2);
  assert.equal(executions, 0);
  assert.equal(result.toolEvents.some((event) => event.status === "denied"), true);
});

test("headless yes-safe allows verification tools and maps verification failure to code 3", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const successRegistry = new ToolRegistry();
  let executions = 0;
  successRegistry.register(createTool("verify_changes", "active", async () => {
    executions += 1;
    return toolSuccess("verify_changes", { results: [] });
  }));

  const successProvider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "verify_1", name: "verify_changes", arguments: "{}" }] }],
    [{ type: "content", content: "verified" }]
  ]);

  const success = await runHeadlessTurn({
    session: new Session(),
    provider: successProvider,
    registry: successRegistry,
    cwd,
    prompt: "verify",
    yesSafe: true
  });

  const failureRegistry = new ToolRegistry();
  failureRegistry.register(createTool("verify_changes", "active", async () =>
    toolFailure("verify_changes", "verification_failed", "npm test failed")
  ));
  const failureProvider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "verify_2", name: "verify_changes", arguments: "{}" }] }],
    [{ type: "content", content: "failed" }]
  ]);

  const failure = await runHeadlessTurn({
    session: new Session(),
    provider: failureProvider,
    registry: failureRegistry,
    cwd,
    prompt: "verify",
    yesSafe: true
  });

  assert.equal(success.exitCode, 0);
  assert.equal(executions, 1);
  assert.equal(failure.exitCode, 3);
});

test("headless json renderer includes content, events, and exit code", () => {
  const rendered = renderHeadlessJson({
    content: "done",
    exitCode: 0,
    verification: { state: "passed", commandCount: 1, elapsedMs: 12 },
    toolEvents: [
      {
        id: "call_1",
        tool: "read_file",
        permission: "passive",
        status: "completed",
        result: { ok: true, tool: "read_file", output: { path: "a.ts" } }
      }
    ]
  });
  const parsed = JSON.parse(rendered) as { content: string; exitCode: number; verification: { state: string; commandCount: number }; toolEvents: unknown[] };

  assert.equal(parsed.content, "done");
  assert.equal(parsed.exitCode, 0);
  assert.deepEqual(parsed.verification, { state: "passed", commandCount: 1, elapsedMs: 12 });
  assert.equal(parsed.toolEvents.length, 1);
});

test("runChatTurn tracks passed verification status", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  registry.register(createTool("verify_changes", "active", async () =>
    toolSuccess("verify_changes", {
      commands: [{ command: "npm test" }, { command: "npm run build" }],
      elapsedMs: 42
    })
  ));
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "verify_1", name: "verify_changes", arguments: "{}" }] }],
    [{ type: "content", content: "verified" }]
  ]);
  const session = new Session();
  session.addUserMessage("verify");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => true
  });

  assert.deepEqual(result.verification, { state: "passed", commandCount: 2, elapsedMs: 42 });
});

test("runChatTurn tracks failed verification status", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  registry.register(createTool("verify_changes", "active", async () =>
    toolFailure("verify_changes", "verification_failed", "npm test failed", {
      failedCommand: "npm test",
      failureSummary: "npm test failed with exit code 1",
      elapsedMs: 99
    })
  ));
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "verify_1", name: "verify_changes", arguments: "{}" }] }],
    [{ type: "content", content: "failed" }]
  ]);
  const session = new Session();
  session.addUserMessage("verify");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => true
  });

  assert.deepEqual(result.verification, {
    state: "failed",
    command: "npm test",
    summary: "npm test failed with exit code 1",
    elapsedMs: 99
  });
});

test("git_restore approval preview includes mode, paths, and focused diff", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  assert.equal((await runFileCommand("git", ["init"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.email", "test@example.com"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.name", "Test User"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "tracked.txt"), "base\n", "utf8");
  assert.equal((await runFileCommand("git", ["add", "tracked.txt"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["commit", "-m", "initial"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "tracked.txt"), "changed\n", "utf8");
  const registry = new ToolRegistry();
  registry.register(createTool("git_restore", "active", async () => toolSuccess("git_restore", {})));
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "restore_1", name: "git_restore", arguments: "{\"paths\":[\"tracked.txt\"]}" }] }],
    [{ type: "content", content: "restore denied" }]
  ]);
  const previews: string[] = [];
  const session = new Session();
  session.addUserMessage("restore file");

  await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    onDelta: () => undefined,
    requestApproval: async (request) => {
      previews.push(request.preview);
      return false;
    }
  });

  assert.match(previews[0] ?? "", /Mode: restore worktree from HEAD/);
  assert.match(previews[0] ?? "", /Paths: tracked\.txt/);
  assert.match(previews[0] ?? "", /changed/);
});

test("web_search tool call executes and final response continues", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const searchProvider = createSearchProvider();

  registry.register({
    name: "web_search",
    description: "search",
    permission: "passive",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    execute: (_args, context) => context.searchProvider?.runWebSearch({ query: "docs" }) ?? Promise.resolve(toolSuccess("web_search", {}))
  });

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "web_search", arguments: "{\"query\":\"docs\"}" }] }],
    [{ type: "content", content: "searched" }]
  ]);
  const session = new Session();
  session.addUserMessage("search web");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    searchProvider,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(result.content, "searched");
  assert.match(session.listMessages().find((message) => message.role === "tool")?.content ?? "", /web result/);
});

test("x_search tool call executes and final response continues", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const searchProvider = createSearchProvider();

  registry.register({
    name: "x_search",
    description: "search x",
    permission: "passive",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    execute: (_args, context) => context.searchProvider?.runXSearch({ query: "x" }) ?? Promise.resolve(toolSuccess("x_search", {}))
  });

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "x_search", arguments: "{\"query\":\"x\"}" }] }],
    [{ type: "content", content: "x searched" }]
  ]);
  const session = new Session();
  session.addUserMessage("search x");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    searchProvider,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(result.content, "x searched");
  assert.match(session.listMessages().find((message) => message.role === "tool")?.content ?? "", /x result/);
});

test("image_understand tool call executes and final response continues", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const imageProvider = createImageProvider();

  registry.register({
    name: "image_understand",
    description: "understand image",
    permission: "passive",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    execute: (_args, context) =>
      context.imageProvider?.understandImage({ imageUrl: "https://example.com/a.png", prompt: "describe" }) ??
      Promise.resolve(toolSuccess("image_understand", {}))
  });

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "image_understand", arguments: "{\"imageUrl\":\"https://example.com/a.png\"}" }] }],
    [{ type: "content", content: "image handled" }]
  ]);
  const session = new Session();
  session.addUserMessage("look at image");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    imageProvider,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(result.content, "image handled");
  assert.match(session.listMessages().find((message) => message.role === "tool")?.content ?? "", /image result/);
});

test("image_generate approval executes once and final response continues", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const imageProvider = createImageProvider();
  let approvals = 0;

  registry.register({
    name: "image_generate",
    description: "generate image",
    permission: "active",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    execute: (_args, context) =>
      context.imageProvider?.generateImage({ prompt: "asset" }) ?? Promise.resolve(toolSuccess("image_generate", {}))
  });

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "image_generate", arguments: "{\"prompt\":\"asset\"}" }] }],
    [{ type: "content", content: "image generated" }]
  ]);
  const session = new Session();
  session.addUserMessage("make image");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    imageProvider,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => {
      approvals += 1;
      return true;
    }
  });

  assert.equal(approvals, 1);
  assert.equal(result.content, "image generated");
  assert.match(session.listMessages().find((message) => message.role === "tool")?.content ?? "", /generated image/);
});

test("context prompt is injected and not persisted in session", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const contextBuilder = createContextBuilder("repo summary");
  const provider = new ScriptedProvider([[{ type: "content", content: "context used" }]]);
  const session = new Session();
  session.addUserMessage("what kind of project is this?");

  await runChatTurn({
    session,
    provider,
    registry,
    contextBuilder,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(provider.messages[0]?.[1]?.role, "system");
  assert.match(String(provider.messages[0]?.[1]?.content), /repo summary/);
  assert.equal(session.listMessages().some((message) => message.content.includes("repo summary")), false);
});

test("tool loop behavior remains unchanged with context enabled", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const contextBuilder = createContextBuilder("repo summary");
  let executed = false;

  registry.register(createTool("read_test", "passive", async () => {
    executed = true;
    return toolSuccess("read_test", { value: "ok" });
  }));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "read_test", arguments: "{}" }] }],
    [{ type: "content", content: "final" }]
  ]);
  const session = new Session();
  session.addUserMessage("use the tool");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    contextBuilder,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(executed, true);
  assert.equal(result.content, "final");
  assert.equal(provider.messages.length, 2);
  assert.equal(provider.messages.every((messages) => String(messages[1]?.content).includes("repo summary")), true);
});

test("old conversation turns are summarized before provider call", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const provider = new ScriptedProvider([[{ type: "content", content: "final" }]]);
  const session = new Session();

  addConversationTurn(session, "old user one " + "x".repeat(80), "old assistant one");
  addConversationTurn(session, "old user two", "old assistant two");
  session.addUserMessage("current user request");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    summarization: { triggerTokenThreshold: 1, targetTokenBudget: 100, retainRecentTurns: 1 },
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(result.content, "final");
  assert.equal(provider.summaryInputs.length, 1);
  assert.equal(provider.summaryInputs[0]?.messages.some((message) => message.content.includes("old user one")), true);
  assert.equal(provider.messages[0]?.some((message) => String(message.content).includes("<conversation_summary>")), true);
  assert.equal(provider.messages[0]?.some((message) => String(message.content).includes("old user one")), false);
  assert.equal(provider.messages[0]?.some((message) => String(message.content).includes("current user request")), true);
  assert.equal(result.context?.conversationSummary.summarized, true);
});

test("summarization failure does not block chat", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  const provider = new ScriptedProvider(
    [[{ type: "content", content: "final" }]],
    { ok: false, error: { code: "summary_failed", message: "boom" } }
  );
  const session = new Session();

  addConversationTurn(session, "old user " + "x".repeat(80), "old assistant");
  session.addUserMessage("current user request");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    summarization: { triggerTokenThreshold: 1, targetTokenBudget: 100, retainRecentTurns: 1 },
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(result.content, "final");
  assert.equal(result.context?.conversationSummary.summarized, false);
  assert.equal(result.context?.conversationSummary.error?.code, "summary_failed");
  assert.equal(provider.messages[0]?.some((message) => String(message.content).includes("old user")), true);
});

test("tool loop still works after conversation compaction", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-runtime-"));
  const registry = new ToolRegistry();
  let executed = false;

  registry.register(createTool("read_test", "passive", async () => {
    executed = true;
    return toolSuccess("read_test", { value: "ok" });
  }));

  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "call_1", name: "read_test", arguments: "{}" }] }],
    [{ type: "content", content: "final" }]
  ]);
  const session = new Session();
  addConversationTurn(session, "old user " + "x".repeat(80), "old assistant");
  session.addUserMessage("use tool now");

  const result = await runChatTurn({
    session,
    provider,
    registry,
    cwd,
    summarization: { triggerTokenThreshold: 1, targetTokenBudget: 100, retainRecentTurns: 1 },
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  assert.equal(executed, true);
  assert.equal(result.content, "final");
  assert.equal(provider.messages.length, 2);
  assert.equal(provider.messages.every((messages) => messages.some((message) => String(message.content).includes("<conversation_summary>"))), true);
});

function createTool(
  name: string,
  permission: "passive" | "active",
  execute: Tool["execute"]
): Tool {
  return {
    name,
    description: `${name} description`,
    permission,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    execute
  };
}

function addConversationTurn(session: Session, user: string, assistant: string): void {
  session.addUserMessage(user);
  session.addAssistantMessage(assistant);
}

function createSearchProvider(): SearchProviderLike {
  return {
    async runWebSearch() {
      return toolSuccess("web_search", {
        query: "docs",
        summary: "web result",
        citations: [],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
      });
    },
    async runXSearch() {
      return toolSuccess("x_search", {
        query: "x",
        summary: "x result",
        citations: [],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
      });
    }
  };
}

function createImageProvider(): ImageProviderLike {
  return {
    async generateImage() {
      return toolSuccess("image_generate", {
        prompt: "asset",
        model: "grok-imagine-image-quality",
        images: [{ path: ".workspace/images/asset.jpg", bytes: 10, index: 0 }],
        summary: "generated image"
      });
    },
    async editImage() {
      return toolSuccess("image_edit", {
        prompt: "edit",
        model: "grok-imagine-image-quality",
        images: [{ path: ".workspace/images/edit.jpg", bytes: 10, index: 0 }],
        sources: [{ type: "url" }]
      });
    },
    async understandImage() {
      return toolSuccess("image_understand", {
        prompt: "describe",
        summary: "image result",
        source: { type: "url" }
      });
    }
  };
}

function createContextBuilder(prompt: string): ContextBuilder {
  return {
    async buildContext() {
      return {
        prompt,
        items: [],
        estimatedTokens: 1,
        truncated: false
      };
    }
  };
}
