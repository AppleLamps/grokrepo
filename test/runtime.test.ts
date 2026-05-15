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
import { toolSuccess, type ImageProviderLike, type SearchProviderLike, type Tool } from "../src/tools/types.js";

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
    async understandImage() {
      return toolSuccess("image_understand", {
        prompt: "describe",
        summary: "image result",
        source: { type: "url" }
      });
    }
  };
}
