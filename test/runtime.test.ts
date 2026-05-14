import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

import type { GrokStreamDelta } from "../src/providers/grok.js";
import { runChatTurn } from "../src/runtime/chat.js";
import { Session } from "../src/runtime/session.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { toolSuccess, type Tool } from "../src/tools/types.js";

class ScriptedProvider {
  readonly messages: ChatCompletionMessageParam[][] = [];
  private readonly turns: GrokStreamDelta[][];

  constructor(turns: GrokStreamDelta[][]) {
    this.turns = turns;
  }

  async *streamChat(messages: ChatCompletionMessageParam[], _tools?: ChatCompletionTool[]): AsyncGenerator<GrokStreamDelta> {
    this.messages.push(messages);
    const nextTurn = this.turns.shift() ?? [];

    for (const event of nextTurn) {
      yield event;
    }
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
