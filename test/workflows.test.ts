import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

import type { ContextBuilder } from "../src/context/index.js";
import { generateUnifiedDiff } from "../src/editing/diff.js";
import type { GrokStreamDelta } from "../src/providers/grok.js";
import { runChatTurn } from "../src/runtime/chat.js";
import { Session } from "../src/runtime/session.js";
import { createDefaultToolRegistry } from "../src/tools/index.js";
import { toolSuccess, type ImageProviderLike, type SearchProviderLike, type ToolApprovalDecision } from "../src/tools/types.js";

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

test("workflow: context, read_file, approved apply_patch, and final response", async () => {
  const cwd = await createWorkspace();
  const original = "export const message = \"old\";\n";
  const updated = "export const message = \"new\";\n";
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "message.ts"), original, "utf8");

  const patch = generateUnifiedDiff("src/message.ts", original, updated);
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "read_1", name: "read_file", arguments: "{\"path\":\"src/message.ts\"}" }] }],
    [
      {
        type: "tool_calls",
        toolCalls: [{ id: "patch_1", name: "apply_patch", arguments: JSON.stringify({ patch, summary: "Update message value" }) }]
      }
    ],
    [{ type: "content", content: "updated message" }]
  ]);
  const session = new Session();
  session.addUserMessage("Update src/message.ts after reading it.");
  const approvals: Array<{ preview: string; decision: ToolApprovalDecision }> = [];
  const events: string[] = [];

  const result = await runChatTurn({
    session,
    provider,
    registry: createDefaultToolRegistry(),
    contextBuilder: createContextBuilder("repo context for src/message.ts"),
    cwd,
    onDelta: () => undefined,
    onToolEvent: (event) => events.push(`${event.tool}:${event.status}`),
    requestApproval: async (request) => {
      const decision = { approved: true, approvedFiles: ["src/message.ts"] };
      approvals.push({ preview: request.preview, decision });
      return decision;
    }
  });

  assert.equal(result.content, "updated message");
  assert.equal(await readFile(path.join(cwd, "src", "message.ts"), "utf8"), updated);
  assert.deepEqual(approvals.map((approval) => approval.decision), [{ approved: true, approvedFiles: ["src/message.ts"] }]);
  assert.equal(events.includes("read_file:completed"), true);
  assert.equal(events.includes("apply_patch:approved"), true);
  assert.equal(session.listMessages().filter((message) => message.role === "tool").length, 2);
  assert.equal(session.listMessages().some((message) => message.content.includes("repo context for src/message.ts")), false);
  assert.match(String(provider.messages[0]?.[1]?.content), /repo context for src\/message\.ts/);
});

test("workflow: passive web search and image understanding execute before synthesis", async () => {
  const cwd = await createWorkspace();
  const searchProvider = createSearchProvider();
  const imageProvider = createImageProvider();
  const calls: string[] = [];

  const provider = new ScriptedProvider([
    [
      { type: "tool_calls", toolCalls: [{ id: "web_1", name: "web_search", arguments: "{\"query\":\"xAI docs\"}" }] },
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "image_1",
            name: "image_understand",
            arguments: "{\"imageUrl\":\"https://example.com/ui.png\",\"prompt\":\"Describe UI\"}"
          }
        ]
      }
    ],
    [{ type: "content", content: "combined answer" }]
  ]);
  const session = new Session();
  session.addUserMessage("Search docs and inspect this screenshot.");

  const result = await runChatTurn({
    session,
    provider,
    registry: createDefaultToolRegistry(),
    searchProvider: {
      async runWebSearch(args) {
        calls.push(`web:${(args as { query: string }).query}`);
        return searchProvider.runWebSearch(args);
      },
      async runXSearch(args) {
        calls.push("x");
        return searchProvider.runXSearch(args);
      }
    },
    imageProvider: {
    async generateImage(args) {
      calls.push("generate");
      return imageProvider.generateImage(args);
    },
    async editImage(args) {
      calls.push("edit");
      return imageProvider.editImage(args);
    },
    async understandImage(args) {
        calls.push(`image:${(args as { prompt: string }).prompt}`);
        return imageProvider.understandImage(args);
      }
    },
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => {
      throw new Error("Passive workflow should not request approval.");
    }
  });

  const toolMessages = session.listMessages().filter((message) => message.role === "tool").map((message) => message.content);

  assert.equal(result.content, "combined answer");
  assert.deepEqual(calls, ["web:xAI docs", "image:Describe UI"]);
  assert.equal(toolMessages.length, 2);
  assert.match(toolMessages[0] ?? "", /web summary/);
  assert.match(toolMessages[1] ?? "", /image summary/);
});

test("workflow: grep informs denied shell command and final explanation", async () => {
  const cwd = await createWorkspace();
  await writeFile(path.join(cwd, "notes.txt"), "alpha\nbeta\n", "utf8");
  let shellExecuted = false;
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "grep_1", name: "grep", arguments: "{\"query\":\"beta\",\"path\":\"notes.txt\"}" }] }],
    [{ type: "tool_calls", toolCalls: [{ id: "shell_1", name: "run_shell", arguments: "{\"command\":\"echo should-not-run\"}" }] }],
    [{ type: "content", content: "shell denied after grep" }]
  ]);
  const session = new Session();
  session.addUserMessage("Find beta, then try a shell command.");

  const result = await runChatTurn({
    session,
    provider,
    registry: createDefaultToolRegistry(),
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false,
    onToolEvent: (event) => {
      if (event.tool === "run_shell" && event.status === "running") {
        shellExecuted = true;
      }
    }
  });

  const toolMessages = session.listMessages().filter((message) => message.role === "tool").map((message) => message.content);

  assert.equal(result.content, "shell denied after grep");
  assert.equal(shellExecuted, false);
  assert.match(toolMessages[0] ?? "", /beta/);
  assert.match(toolMessages[1] ?? "", /approval_denied/);
});

test("workflow: approved patch rollback failure preserves all files", async () => {
  const cwd = await createWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");
  await writeFile(path.join(cwd, "b.txt"), "actual\n", "utf8");
  const patch = [
    generateUnifiedDiff("a.txt", "one\n", "two\n"),
    generateUnifiedDiff("b.txt", "expected\n", "updated\n")
  ].join("\n");
  const provider = new ScriptedProvider([
    [{ type: "tool_calls", toolCalls: [{ id: "patch_1", name: "apply_patch", arguments: JSON.stringify({ patch }) }] }],
    [{ type: "content", content: "rollback handled" }]
  ]);
  const session = new Session();
  session.addUserMessage("Apply a risky patch.");

  const result = await runChatTurn({
    session,
    provider,
    registry: createDefaultToolRegistry(),
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => ({ approved: true, approvedFiles: ["a.txt", "b.txt"] })
  });

  const toolMessage = session.listMessages().find((message) => message.role === "tool")?.content ?? "";

  assert.equal(result.content, "rollback handled");
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "one\n");
  assert.equal(await readFile(path.join(cwd, "b.txt"), "utf8"), "actual\n");
  assert.match(toolMessage, /apply_failed/);
});

test("workflow: image_edit denial prevents provider call", async () => {
  const cwd = await createWorkspace();
  let editCalls = 0;
  const imageProvider: ImageProviderLike = {
    async generateImage() {
      return toolSuccess("image_generate", {});
    },
    async editImage() {
      editCalls += 1;
      return toolSuccess("image_edit", {});
    },
    async understandImage() {
      return toolSuccess("image_understand", {});
    }
  };
  const provider = new ScriptedProvider([
    [
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "edit_1",
            name: "image_edit",
            arguments: "{\"prompt\":\"make it blue\",\"images\":[\"https://example.com/source.png\"]}"
          }
        ]
      }
    ],
    [{ type: "content", content: "edit denied" }]
  ]);
  const session = new Session();
  session.addUserMessage("Edit this image.");

  const result = await runChatTurn({
    session,
    provider,
    registry: createDefaultToolRegistry(),
    imageProvider,
    cwd,
    onDelta: () => undefined,
    requestApproval: async () => false
  });

  const toolMessage = session.listMessages().find((message) => message.role === "tool")?.content ?? "";

  assert.equal(result.content, "edit denied");
  assert.equal(editCalls, 0);
  assert.match(toolMessage, /approval_denied/);
});

async function createWorkspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-workflow-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { ink: "1.0.0", react: "1.0.0" } }), "utf8");
  await writeFile(path.join(cwd, "tsconfig.json"), "{}", "utf8");
  return cwd;
}

function createSearchProvider(): SearchProviderLike {
  return {
    async runWebSearch() {
      return toolSuccess("web_search", {
        query: "xAI docs",
        summary: "web summary",
        citations: [{ title: "Docs", url: "https://docs.x.ai" }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
      });
    },
    async runXSearch() {
      return toolSuccess("x_search", {
        query: "x",
        summary: "x summary",
        citations: []
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
        images: [{ path: ".workspace/images/asset.jpg", bytes: 10, index: 0 }]
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
        prompt: "Describe UI",
        summary: "image summary",
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
