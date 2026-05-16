import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderSummarizationPrompt, GrokProvider } from "../src/providers/grok.js";
import { Session, type ConversationSummary, type SerializedSession } from "../src/runtime/session.js";
import { defaultSessionPath, restoreOrCreateSession, saveSession } from "../src/runtime/session-store.js";
import {
  summarizeSessionIfNeeded,
  type ConversationSummarizationInput,
  type ConversationSummarizer,
  type SummarizationResult
} from "../src/runtime/summarization.js";

test("summarization skips below eligibility threshold", async () => {
  const session = new Session();
  const summarizer = createSummarizer();

  session.addUserMessage("short");

  const metadata = await summarizeSessionIfNeeded(session, summarizer, {
    triggerTokenThreshold: 10_000,
    targetTokenBudget: 100,
    retainRecentTurns: 1
  });

  assert.equal(metadata.attempted, false);
  assert.equal(metadata.summarized, false);
  assert.equal(summarizer.inputs.length, 0);
});

test("summarization retains recent turns and covers older complete turns", async () => {
  const session = new Session();
  const summarizer = createSummarizer();

  addTurn(session, "old one " + "x".repeat(80), "assistant one");
  addTurn(session, "old two", "assistant two");
  addTurn(session, "recent user", "recent assistant");

  const metadata = await summarizeSessionIfNeeded(session, summarizer, {
    triggerTokenThreshold: 1,
    targetTokenBudget: 100,
    retainRecentTurns: 1
  });

  assert.equal(metadata.summarized, true);
  assert.equal(summarizer.inputs.length, 1);
  assert.equal(summarizer.inputs[0]?.messages.some((message) => message.content.includes("old one")), true);
  assert.equal(summarizer.inputs[0]?.messages.some((message) => message.content.includes("recent user")), false);
  assert.equal(session.activeMessages().some((message) => message.content.includes("old one")), false);
  assert.equal(session.activeMessages().some((message) => message.content.includes("recent user")), true);
});

test("summarization keeps assistant tool calls with paired tool results", async () => {
  const session = new Session();
  const summarizer = createSummarizer();

  session.addUserMessage("read src/a.ts");
  session.addAssistantMessage("", [{ id: "tool_1", name: "read_file", arguments: "{\"path\":\"src/a.ts\"}" }]);
  session.addToolMessage("tool_1", JSON.stringify({ ok: true, tool: "read_file", output: { path: "src/a.ts" } }));
  session.addUserMessage("current request");

  await summarizeSessionIfNeeded(session, summarizer, {
    triggerTokenThreshold: 1,
    targetTokenBudget: 100,
    retainRecentTurns: 1
  });

  const summarizedRoles = summarizer.inputs[0]?.messages.map((message) => message.role);

  assert.deepEqual(summarizedRoles, ["user", "assistant", "tool"]);
  assert.equal(summarizer.inputs[0]?.messages.some((message) => message.toolCalls?.[0]?.name === "read_file"), true);
  assert.equal(summarizer.inputs[0]?.messages.some((message) => message.toolCallId === "tool_1"), true);
});

test("session serializes summary and toChatMessages excludes covered messages", () => {
  const session = new Session();
  const old = session.addUserMessage("old request");
  session.addAssistantMessage("old answer");
  session.addUserMessage("new request");
  const summary = createSummary([old.id], "Old request was answered.");

  session.setConversationSummary(summary);
  const restored = new Session(session.serialize());
  const messages = restored.toChatMessages("repo context");

  assert.deepEqual(restored.getConversationSummary(), summary);
  assert.equal(messages.some((message) => message.role === "system" && String(message.content).includes("repo context")), true);
  assert.equal(messages.some((message) => message.role === "system" && String(message.content).includes("<conversation_summary>")), true);
  assert.equal(messages.some((message) => String(message.content).includes("old request")), false);
  assert.equal(messages.some((message) => String(message.content).includes("new request")), true);
});

test("session saves and restores a full disk round trip", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-session-"));
  const sessionPath = path.join(cwd, "sessions", "session.json");
  const session = new Session();
  const old = session.addUserMessage("old request");
  session.addAssistantMessage("old answer");
  session.addUserMessage("new request");
  session.setConversationSummary(createSummary([old.id], "Old request was answered."));

  await session.save(sessionPath);
  const restored = await Session.restore(sessionPath);

  assert.deepEqual(restored.serialize(), session.serialize());
});

test("restoreOrCreateSession restores current workspace session", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-session-store-"));
  const sessionPath = defaultSessionPath(cwd);
  const session = new Session();
  session.addUserMessage("persist this");
  await saveSession(session, sessionPath);

  const restored = await restoreOrCreateSession(cwd);

  assert.equal(restored.path, sessionPath);
  assert.equal(restored.restored, true);
  assert.equal(restored.error, undefined);
  assert.equal(restored.session.listMessages().some((message) => message.content === "persist this"), true);
});

test("restoreOrCreateSession falls back to fresh session when current file is missing", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-session-store-"));
  const restored = await restoreOrCreateSession(cwd);

  assert.equal(restored.path, defaultSessionPath(cwd));
  assert.equal(restored.restored, false);
  assert.equal(restored.error, undefined);
  assert.equal(restored.session.listMessages()[0]?.role, "system");
});

test("restoreOrCreateSession reports corrupt session and starts fresh", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-session-store-"));
  const sessionPath = defaultSessionPath(cwd);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, "{bad json", "utf8");

  const restored = await restoreOrCreateSession(cwd);

  assert.equal(restored.restored, false);
  assert.equal(restored.error?.code, "restore_failed");
  assert.equal(restored.session.listMessages()[0]?.role, "system");
});

test("toChatMessages prepends context when restored session has no system message", () => {
  const session = new Session({
    id: "session_without_system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "hello",
        createdAt: "2026-01-01T00:00:01.000Z",
        turnId: "t1"
      }
    ]
  });

  const messages = session.toChatMessages("repo context");

  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[0]?.content, "repo context");
  assert.equal(messages[1]?.role, "user");
  assert.equal(messages[1]?.content, "hello");
});

test("restored sessions without turn ids are grouped by user boundaries", () => {
  const seed: SerializedSession = {
    id: "session_old",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      { id: "system", role: "system", content: "system", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "u1", role: "user", content: "user one", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: "a1", role: "assistant", content: "assistant one", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: "u2", role: "user", content: "user two", createdAt: "2026-01-01T00:00:03.000Z" }
    ]
  };
  const session = new Session(seed);
  const messages = session.listMessages();

  assert.equal(messages[1]?.turnId, messages[2]?.turnId);
  assert.notEqual(messages[1]?.turnId, messages[3]?.turnId);
});

test("mock summarizer is deterministic", async () => {
  const provider = new GrokProvider({
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    imageModel: "grok-imagine-image-quality",
    mock: true
  });
  const input: ConversationSummarizationInput = {
    messages: [{ id: "u1", role: "user", content: "fix src/app.ts", createdAt: "2026-01-01T00:00:00.000Z", turnId: "t1" }],
    targetTokenBudget: 100
  };

  const first = await provider.summarizeConversation(input);
  const second = await provider.summarizeConversation(input);

  assert.equal(first.ok, true);
  assert.equal(first.summary, second.summary);
  assert.match(first.summary ?? "", /fix src\/app\.ts/);
});

test("provider summary prompt preserves operational details", () => {
  const prompt = renderSummarizationPrompt({
    previousSummary: createSummary(["m0"], "Earlier work changed README.md."),
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Edit src/app.ts, then run npm test.",
        createdAt: "2026-01-01T00:00:01.000Z",
        turnId: "t1"
      },
      {
        id: "m2",
        role: "tool",
        content: JSON.stringify({ ok: false, tool: "run_shell", error: { code: "approval_denied", message: "denied" } }),
        createdAt: "2026-01-01T00:00:02.000Z",
        turnId: "t1",
        toolCallId: "tool_1"
      }
    ],
    targetTokenBudget: 100
  });

  assert.match(prompt, /Earlier work changed README\.md/);
  assert.match(prompt, /src\/app\.ts/);
  assert.match(prompt, /npm test/);
  assert.match(prompt, /approval_denied/);
  assert.match(prompt, /toolCallId: tool_1/);
});

function createSummarizer(result: SummarizationResult = { ok: true, summary: "compact summary" }): ConversationSummarizer & {
  inputs: ConversationSummarizationInput[];
} {
  return {
    inputs: [],
    async summarizeConversation(input) {
      this.inputs.push(input);
      return result;
    }
  };
}

function addTurn(session: Session, user: string, assistant: string): void {
  session.addUserMessage(user);
  session.addAssistantMessage(assistant);
}

function createSummary(coveredMessageIds: string[], text: string): ConversationSummary {
  return {
    id: "summary_1",
    text,
    coveredMessageIds,
    sourceMessageCount: coveredMessageIds.length,
    estimatedTokens: Math.ceil(text.length / 4),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
