import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { approvalPanelModel } from "../src/cli/approval-panel.js";
import { mergeToolEvent } from "../src/cli/app.js";
import {
  composerState,
  deleteWordBeforeCursor,
  insertAtCursor,
  moveCursor,
  navigateHistory,
  removeAtCursor,
  removeBeforeCursor
} from "../src/cli/composer.js";
import { debugPanelModel } from "../src/cli/debug-panel.js";
import { diffLineColor, renderDiffLines } from "../src/cli/diff-renderer.js";
import { headerModel } from "../src/cli/header.js";
import { helpPanelModel } from "../src/cli/help-panel.js";
import { messageListItems } from "../src/cli/message-list.js";
import { statusBarModel, statusBarParts } from "../src/cli/status-bar.js";
import { getTheme, parseThemeMode } from "../src/cli/theme.js";
import { groupToolEvents, toolTimelineHint } from "../src/cli/tool-timeline.js";
import { isExpandableSearchEvent, searchResultDetails } from "../src/cli/output.js";
import { compactToolSummary, statusColor, statusLabel } from "../src/cli/ui-format.js";
import type { ToolRuntimeEvent } from "../src/runtime/chat.js";
import { loadConfig } from "../src/utils/config.js";
import { debugLogLine, debugLogPath, readDebugLogTail } from "../src/utils/debug-log.js";

test("diff renderer colors added, removed, hunk, and file header lines", () => {
  assert.equal(diffLineColor("+++ README.md"), "gray");
  assert.equal(diffLineColor("--- README.md"), "gray");
  assert.equal(diffLineColor("@@ -1,1 +1,1 @@"), "cyan");
  assert.equal(diffLineColor("+new line"), "green");
  assert.equal(diffLineColor("-old line"), "red");
  assert.equal(diffLineColor(" unchanged"), "gray");
});

test("diff renderer trims visible lines and reports remaining count", () => {
  const rendered = renderDiffLines(["--- a", "+++ b", "+one", "-two"].join("\n"), 2);

  assert.deepEqual(rendered.lines.map((line) => line.text), ["--- a", "+++ b"]);
  assert.equal(rendered.remaining, 2);
});

test("search result expansion extracts summary, citations, usage, and raw tool usage", () => {
  const event: ToolRuntimeEvent = {
    id: "search_1",
    tool: "web_search",
    permission: "passive",
    status: "completed",
    result: {
      ok: true,
      tool: "web_search",
      output: {
        query: "docs",
        summary: "summary",
        citations: [{ title: "Docs", url: "https://docs.x.ai" }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        rawToolUsage: { web_search: 1 }
      }
    }
  };

  assert.equal(isExpandableSearchEvent(event), true);
  assert.deepEqual(searchResultDetails(event), {
    summary: "summary",
    citations: [{ title: "Docs", url: "https://docs.x.ai" }],
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    rawToolUsage: { web_search: 1 }
  });
});

test("tool timeline shows latest search detail toggle hint", () => {
  const events: ToolRuntimeEvent[] = [
    {
      id: "search_1",
      tool: "web_search",
      permission: "passive",
      status: "completed",
      result: {
        ok: true,
        tool: "web_search",
        output: {
          query: "docs",
          summary: "summary",
          citations: []
        }
      }
    }
  ];
  const items = groupToolEvents(events);

  assert.equal(toolTimelineHint(items), "Tab expands latest search details");
  assert.equal(toolTimelineHint(items, ["search_1"]), "Tab collapses latest search details");
});

test("search result expansion ignores non-search events", () => {
  const event: ToolRuntimeEvent = {
    id: "read_1",
    tool: "read_file",
    permission: "passive",
    status: "completed",
    result: {
      ok: true,
      tool: "read_file",
      output: { content: "hello" }
    }
  };

  assert.equal(isExpandableSearchEvent(event), false);
  assert.equal(searchResultDetails(event), undefined);
});

test("tool timeline groups repeated events by call id", () => {
  const events: ToolRuntimeEvent[] = [
    { id: "call_1", tool: "read_file", permission: "passive", status: "requested", args: { path: "src/a.ts" } },
    { id: "call_1", tool: "read_file", permission: "passive", status: "running", args: { path: "src/a.ts" } },
    {
      id: "call_1",
      tool: "read_file",
      permission: "passive",
      status: "completed",
      args: { path: "src/a.ts" },
      result: { ok: true, tool: "read_file", output: { path: "src/a.ts", size: 12 } }
    }
  ];

  const grouped = groupToolEvents(events);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.label, "done");
  assert.equal(grouped[0]?.color, "green");
  assert.equal(grouped[0]?.summary, "src/a.ts (12 bytes)");
});

test("tool status labels and colors are readable", () => {
  assert.equal(statusLabel("approval_requested"), "waiting approval");
  assert.equal(statusLabel("completed", true), "done");
  assert.equal(statusLabel("completed", false), "failed");
  assert.equal(statusColor("running"), "cyan");
  assert.equal(statusColor("denied"), "red");
});

test("compactToolSummary covers core tool result branches", () => {
  const cases: Array<[ToolRuntimeEvent, string]> = [
    [
      {
        id: "read",
        tool: "read_file",
        permission: "passive",
        status: "completed",
        args: { path: "src/a.ts" },
        result: { ok: true, tool: "read_file", output: { path: "src/a.ts", size: 12 } }
      },
      "src/a.ts (12 bytes)"
    ],
    [
      {
        id: "write",
        tool: "write_file",
        permission: "active",
        status: "completed",
        args: { path: "out.txt", content: "hello" }
      },
      "out.txt (5 bytes)"
    ],
    [
      {
        id: "file_info",
        tool: "file_info",
        permission: "passive",
        status: "completed",
        args: { path: "src/a.ts" },
        result: { ok: true, tool: "file_info", output: { path: "src/a.ts", type: "file", size: 12 } }
      },
      "src/a.ts file (12 bytes)"
    ],
    [
      {
        id: "mkdir",
        tool: "create_directory",
        permission: "active",
        status: "completed",
        args: { path: "src/new" },
        result: { ok: true, tool: "create_directory", output: { path: "src/new" } }
      },
      "src/new"
    ],
    [
      {
        id: "copy",
        tool: "copy_file",
        permission: "active",
        status: "completed",
        args: { source: "a.txt", destination: "b.txt" },
        result: { ok: true, tool: "copy_file", output: { source: "a.txt", destination: "b.txt" } }
      },
      "a.txt -> b.txt"
    ],
    [
      {
        id: "move",
        tool: "move_file",
        permission: "active",
        status: "completed",
        args: { source: "b.txt", destination: "c.txt" },
        result: { ok: true, tool: "move_file", output: { source: "b.txt", destination: "c.txt" } }
      },
      "b.txt -> c.txt"
    ],
    [
      {
        id: "delete",
        tool: "delete_file",
        permission: "active",
        status: "completed",
        args: { path: "c.txt" },
        result: { ok: true, tool: "delete_file", output: { originalPath: "c.txt", trashPath: ".workspace/trash/trash_1/files/c.txt" } }
      },
      "c.txt -> .workspace/trash/trash_1/files/c.txt"
    ],
    [
      {
        id: "list",
        tool: "list_files",
        permission: "passive",
        status: "completed",
        args: { path: "src" },
        result: { ok: true, tool: "list_files", output: { path: "src", entries: [{ name: "a.ts" }] } }
      },
      "src, 1 entries"
    ],
    [
      {
        id: "range",
        tool: "read_file_range",
        permission: "passive",
        status: "completed",
        args: { path: "src/a.ts", startLine: 3, endLine: 8 },
        result: { ok: true, tool: "read_file_range", output: { path: "src/a.ts", startLine: 3, endLine: 8 } }
      },
      "src/a.ts:3-8"
    ],
    [
      {
        id: "tree",
        tool: "list_tree",
        permission: "passive",
        status: "completed",
        args: { path: "." },
        result: { ok: true, tool: "list_tree", output: { path: ".", entries: [{ path: "src" }, { path: "README.md" }] } }
      },
      "., 2 entries"
    ],
    [
      {
        id: "definitions",
        tool: "list_code_definitions",
        permission: "passive",
        status: "completed",
        args: { path: "src" },
        result: { ok: true, tool: "list_code_definitions", output: { path: "src", definitions: [{ name: "App" }] } }
      },
      "src, 1 definitions"
    ],
    [
      {
        id: "references",
        tool: "find_references",
        permission: "passive",
        status: "completed",
        args: { query: "App" },
        result: { ok: true, tool: "find_references", output: { query: "App", matches: [{ path: "src/app.tsx" }] } }
      },
      "App, 1 matches"
    ],
    [
      {
        id: "grep",
        tool: "grep",
        permission: "passive",
        status: "completed",
        args: { query: "needle" },
        result: { ok: true, tool: "grep", output: { matches: [{ path: "a.txt" }, { path: "b.txt" }] } }
      },
      "needle, 2 matches"
    ],
    [{ id: "status", tool: "git_status", permission: "passive", status: "completed" }, "working tree status"],
    [{ id: "diff", tool: "git_diff", permission: "passive", status: "completed" }, "working tree diff"],
    [
      {
        id: "project",
        tool: "analyze_project_structure",
        permission: "passive",
        status: "completed",
        result: { ok: true, tool: "analyze_project_structure", output: { frameworks: ["TypeScript"], modules: [{ path: "src" }], tests: ["test/a.test.ts"] } }
      },
      "1 frameworks, 1 modules, 1 tests"
    ],
    [{ id: "log", tool: "git_log", permission: "passive", status: "completed", result: { ok: true, tool: "git_log", output: { commits: [{ hash: "a" }] } } }, "1 commit"],
    [
      {
        id: "branch",
        tool: "git_branch",
        permission: "passive",
        status: "completed",
        result: { ok: true, tool: "git_branch", output: { current: "main", branches: ["main", "feature"] } }
      },
      "main, 2 branches"
    ],
    [{ id: "show", tool: "git_show", permission: "passive", status: "completed", args: { ref: "HEAD", path: "src/a.ts" } }, "HEAD:src/a.ts"],
    [{ id: "diff_file", tool: "git_diff_file", permission: "passive", status: "completed", args: { path: "src/a.ts", staged: true } }, "src/a.ts staged"],
    [
      {
        id: "stage",
        tool: "git_stage",
        permission: "active",
        status: "completed",
        args: { paths: ["src/a.ts"] },
        result: { ok: true, tool: "git_stage", output: { stagedPaths: ["src/a.ts"] } }
      },
      "1 staged path"
    ],
    [
      {
        id: "restore",
        tool: "git_restore",
        permission: "active",
        status: "completed",
        args: { paths: ["src/a.ts"] },
        result: { ok: true, tool: "git_restore", output: { paths: ["src/a.ts"], staged: false } }
      },
      "1 restored path"
    ],
    [{ id: "commit", tool: "git_commit", permission: "active", status: "completed", args: { message: "save work" } }, "save work"],
    [{ id: "shell", tool: "run_shell", permission: "active", status: "completed", args: { command: "npm test" } }, "npm test"],
    [{ id: "patch", tool: "apply_patch", permission: "active", status: "completed", args: { summary: "fix parser" } }, "fix parser"],
    [{ id: "undo", tool: "undo_patch", permission: "active", status: "completed" }, "latest backup"],
    [
      {
        id: "checkpoint_create",
        tool: "checkpoint_create",
        permission: "active",
        status: "completed",
        args: { name: "before edits" },
        result: { ok: true, tool: "checkpoint_create", output: { id: "checkpoint_1", name: "before edits", fileCount: 3 } }
      },
      "checkpoint_1 before edits, 3 files"
    ],
    [
      {
        id: "checkpoint_list",
        tool: "checkpoint_list",
        permission: "passive",
        status: "completed",
        result: { ok: true, tool: "checkpoint_list", output: { checkpoints: [{ id: "checkpoint_1" }] } }
      },
      "1 checkpoint"
    ],
    [
      {
        id: "checkpoint_restore",
        tool: "checkpoint_restore",
        permission: "active",
        status: "completed",
        args: { id: "checkpoint_1" },
        result: {
          ok: true,
          tool: "checkpoint_restore",
          output: { id: "checkpoint_1", restoredFiles: ["a.ts", "b.ts"], removedFiles: ["new.ts"] }
        }
      },
      "checkpoint_1, 2 restored, 1 removed"
    ],
    [
      {
        id: "web",
        tool: "web_search",
        permission: "passive",
        status: "completed",
        args: { query: "docs" },
        result: { ok: true, tool: "web_search", output: { query: "docs", citations: [{ url: "https://example.com" }] } }
      },
      "docs, 1 sources"
    ],
    [
      {
        id: "image",
        tool: "image_generate",
        permission: "active",
        status: "completed",
        args: { prompt: "logo" },
        result: { ok: true, tool: "image_generate", output: { images: [{ path: "one.png" }] } }
      },
      "logo, 1 image"
    ],
    [
      {
        id: "clip",
        tool: "capture_clipboard_image",
        permission: "active",
        status: "completed",
        result: { ok: true, tool: "capture_clipboard_image", output: { path: ".workspace/images/clip.png", bytes: 100 } }
      },
      "clipboard -> .workspace/images/clip.png (100 bytes)"
    ],
    [{ id: "unknown", tool: "unknown_tool", permission: "passive", status: "completed" }, "passive tool"]
  ];

  for (const [event, expected] of cases) {
    assert.equal(compactToolSummary(event), expected);
  }
});

test("compactToolSummary surfaces structured errors", () => {
  assert.equal(
    compactToolSummary({
      id: "read",
      tool: "read_file",
      permission: "passive",
      status: "completed",
      result: { ok: false, tool: "read_file", error: { code: "read_failed", message: "file missing" } }
    }),
    "file missing"
  );
});

test("approval panel model shows patch selected file count", () => {
  const model = approvalPanelModel(
    {
      call: { id: "patch_1", name: "apply_patch", arguments: "{}", parsedArguments: {} },
      tool: {
        name: "apply_patch",
        description: "patch",
        permission: "active",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute() {
          return { ok: true, tool: "apply_patch", output: {} };
        }
      },
      kind: "patch",
      preview: "Patch changes 2 files.",
      files: ["src/a.ts", "src/b.ts"]
    },
    ["src/a.ts"]
  );

  assert.equal(model.title, "APPROVAL apply_patch");
  assert.equal(model.fileSummary, "1/2 files selected");
  assert.match(model.controls, /toggle files/);
});

test("approval panel model displays high-risk shell controls", () => {
  const model = approvalPanelModel({
    call: { id: "shell_1", name: "run_shell", arguments: "{}", parsedArguments: {} },
    tool: {
      name: "run_shell",
      description: "shell",
      permission: "active",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return { ok: true, tool: "run_shell", output: {} };
      }
    },
    kind: "standard",
    preview: "rm -rf dist",
    risk: {
      level: "destructive",
      reason: "Deletes files.",
      requiresStrongConfirmation: true
    }
  });

  assert.match(model.preview, /risk: destructive - Deletes files\./);
  assert.match(model.controls, /!/);
  assert.doesNotMatch(model.controls, /y allow/);
});

test("status bar displays busy, usage, context, and error states", () => {
  const parts = statusBarParts({
    busy: true,
    error: "boom",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    contextMetadata: {
      repoContext: { estimatedTokens: 10, truncated: true, itemCount: 2 },
      conversationSummary: {
        activeTokensBefore: 100,
        attempted: true,
        summarized: true,
        retainedTurns: 6,
        coveredMessageCount: 8,
        estimatedTokens: 20
      }
    }
  });

  assert.deepEqual(parts, [
    "tokens p:1 c:2 t:3",
    "repo 10t truncated",
    "summary 8 msgs -> 20t",
    "working",
    "error boom",
    "retry /retry"
  ]);
});

test("composer disabled state renders as waiting", () => {
  assert.deepEqual(composerState(true, 80), {
    prompt: "...",
    cursor: "",
    hint: "waiting for current action",
    separator: "-".repeat(78)
  });
  assert.deepEqual(composerState(false, 96), {
    prompt: ">  ",
    cursor: "_",
    hint: "/help /exit /retry /debug /clip | arrows/history | ctrl+a/e/u/k/w",
    separator: "-".repeat(94)
  });
  assert.deepEqual(composerState(false, 50), {
    prompt: ">  ",
    cursor: "_",
    hint: "/help /exit /clip | arrows edit",
    separator: "-".repeat(48)
  });
});

test("header model compacts long provider status", () => {
  const model = headerModel("grok-4.3 via https://api.x.ai/v1 using XAI_API_KEY", false, 78, "dark", false, "C:\\Users\\lucas\\Desktop\\grokcode");

  assert.equal(model.mark, "GC>");
  assert.equal(model.title, "GrokCode");
  assert.equal(model.providerLine.includes("https://api.x.ai/v1"), false);
  assert.equal(model.providerLine.includes("Phase 7"), false);
  assert.equal(model.providerLine.includes("CONN"), false);
  assert.equal(model.providerLine.includes("x.ai"), true);
  assert.equal(model.cwdLine.includes("grokcode"), true);
  assert.equal(model.providerLine.length <= 76, true);
  assert.equal(model.separator.length, 76);
});

test("header model caps debug line to terminal width", () => {
  const model = headerModel("grok-4.3 via https://api.x.ai/v1 using XAI_API_KEY", false, 72, "dark", true);

  assert.equal(model.providerLine.length <= 70, true);
  assert.match(model.providerLine, /debug/);
});

test("theme parser supports dark, light, and compact defaults", () => {
  assert.equal(parseThemeMode("light"), "light");
  assert.equal(parseThemeMode("compact"), "compact");
  assert.equal(parseThemeMode("unknown"), "dark");
  assert.equal(getTheme("compact").dense, true);
});

test("status bar includes debug state when enabled", () => {
  assert.deepEqual(statusBarParts({ busy: false, debug: true }), ["idle", "debug"]);
});

test("status bar emits quiet model and workspace metadata without session label", () => {
  const parts = statusBarParts({
    busy: false,
    providerStatus: "grok-4.3 via https://api.x.ai/v1 using XAI_API_KEY",
    cwd: "C:\\Users\\lucas\\Desktop\\grokcode"
  });

  assert.equal(parts[0], "grok-4.3 | x.ai | XAI_API_KEY");
  assert.equal(parts.includes("SESSION"), false);
  assert.equal(parts.includes("grokcode"), true);
});

test("status bar includes current task mode", () => {
  assert.deepEqual(statusBarParts({ busy: false, taskMode: "plan" }), ["mode plan", "idle"]);
  assert.deepEqual(statusBarParts({ busy: false, taskMode: "act" }), ["mode act", "idle"]);
});

test("status bar includes verification status when available", () => {
  assert.deepEqual(statusBarParts({ busy: false, verification: { state: "passed", commandCount: 2 } }), ["verify passed 2 cmds", "idle"]);
  assert.deepEqual(
    statusBarParts({ busy: false, verification: { state: "failed", command: "npm test", summary: "failed" } }),
    ["verify failed npm test", "idle"]
  );
  assert.deepEqual(statusBarParts({ busy: false, verification: { state: "not_run" } }), ["idle"]);
});

test("status bar model splits left metadata from right state", () => {
  const model = statusBarModel(
    {
      busy: true,
      debug: true,
      providerStatus: "grok-4.3 via https://api.x.ai/v1 using XAI_API_KEY",
      cwd: "C:\\Users\\lucas\\Desktop\\grokcode",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
    },
    96
  );

  assert.match(model.left, /grok-4\.3/);
  assert.match(model.left, /grokcode/);
  assert.match(model.left, /tokens/);
  assert.equal(model.right, "working | debug");
  assert.equal(model.left.includes("working"), false);
});

test("help panel model lists terminal commands", () => {
  const model = helpPanelModel();

  assert.equal(model.title, "HELP commands");
  assert.equal(model.lines.some((line) => line.includes("/help")), true);
  assert.equal(model.lines.some((line) => line.includes("/retry")), true);
  assert.equal(model.lines.some((line) => line.includes("/plan")), true);
  assert.equal(model.lines.some((line) => line.includes("/act")), true);
  assert.equal(model.lines.some((line) => line.includes("/mode")), true);
  assert.equal(model.lines.some((line) => line.includes("/checkpoint")), true);
  assert.equal(model.lines.some((line) => line.includes("Tab")), true);
});

test("message list keeps empty streaming assistant placeholder while busy", () => {
  const items = messageListItems(
    [
      { id: "user_1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "assistant_1", role: "assistant", content: "", createdAt: "2026-01-01T00:00:01.000Z" }
    ],
    true
  );

  assert.equal(items.length, 2);
  assert.equal(items[1]?.placeholder, true);
});

test("message list hides empty assistant placeholder when idle", () => {
  const items = messageListItems(
    [
      { id: "user_1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "assistant_1", role: "assistant", content: "", createdAt: "2026-01-01T00:00:01.000Z" }
    ],
    false
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.message.role, "user");
});

test("mergeToolEvent replaces existing call state without changing order", () => {
  const first: ToolRuntimeEvent = { id: "call_1", tool: "read_file", permission: "passive", status: "requested" };
  const second: ToolRuntimeEvent = { id: "call_2", tool: "grep", permission: "passive", status: "requested" };
  const update: ToolRuntimeEvent = { id: "call_1", tool: "read_file", permission: "passive", status: "completed" };

  assert.deepEqual(mergeToolEvent([first, second], update), [update, second]);
});

test("composer history navigation preserves draft and walks commands", () => {
  const history = ["first", "second"];
  const up = navigateHistory(history, { value: "draft", draft: "" }, "up");
  const upAgain = navigateHistory(history, up, "up");
  const down = navigateHistory(history, upAgain, "down");
  const backToDraft = navigateHistory(history, down, "down");

  assert.deepEqual(up, { index: 1, draft: "draft", value: "second" });
  assert.deepEqual(upAgain, { index: 0, draft: "draft", value: "first" });
  assert.deepEqual(down, { index: 1, draft: "draft", value: "second" });
  assert.deepEqual(backToDraft, { index: undefined, draft: "draft", value: "draft" });
});

test("composer cursor editing supports insertion, deletion, and movement", () => {
  assert.deepEqual(insertAtCursor({ value: "helo", cursor: 2 }, "l"), { value: "hello", cursor: 3 });
  assert.deepEqual(removeBeforeCursor({ value: "hello", cursor: 3 }), { value: "helo", cursor: 2 });
  assert.deepEqual(removeAtCursor({ value: "hello", cursor: 1 }), { value: "hllo", cursor: 1 });
  assert.deepEqual(deleteWordBeforeCursor({ value: "run npm test", cursor: 12 }), { value: "run npm", cursor: 7 });
  assert.deepEqual(moveCursor({ value: "abc", cursor: 1 }, "left"), { value: "abc", cursor: 0 });
  assert.deepEqual(moveCursor({ value: "abc", cursor: 1 }, "right"), { value: "abc", cursor: 2 });
  assert.deepEqual(moveCursor({ value: "abc", cursor: 2 }, "start"), { value: "abc", cursor: 0 });
  assert.deepEqual(moveCursor({ value: "abc", cursor: 0 }, "end"), { value: "abc", cursor: 3 });
});

test("debug log line redacts secrets", () => {
  const line = debugLogLine({
    timestamp: "2026-01-01T00:00:00.000Z",
    event: "test",
    data: {
      apiKey: "fixture-secret",
      command: `Authorization: ${"Bearer"} abc123`
    }
  });

  assert.match(line, /"apiKey":"\[redacted\]"/);
  assert.match(line, /Bearer \[redacted\]/);
  assert.doesNotMatch(line, /fixture-secret/);
});

test("debug log line avoids false Bearer redaction and redacts nested secrets", () => {
  const line = debugLogLine({
    timestamp: "2026-01-01T00:00:00.000Z",
    event: "test",
    data: {
      command: "Authorization: Bearer",
      nested: {
        apiKey: "nested-secret"
      }
    }
  });

  assert.match(line, /Authorization: Bearer/);
  assert.match(line, /"apiKey":"\[redacted\]"/);
  assert.doesNotMatch(line, /nested-secret/);
});

test("readDebugLogTail parses recent redacted debug entries", async () => {
  const cwd = await mkdirTempWorkspace();
  await mkdir(path.dirname(debugLogPath(cwd)), { recursive: true });
  await writeFile(
    debugLogPath(cwd),
    [
      debugLogLine({ timestamp: "2026-01-01T00:00:00.000Z", event: "first", data: { apiKey: "secret" } }),
      debugLogLine({ timestamp: "2026-01-01T00:00:01.000Z", event: "second", data: { value: 2 } }),
      "not-json\n"
    ].join(""),
    "utf8"
  );

  const entries = await readDebugLogTail(cwd, 2);

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.event, "second");
  assert.deepEqual(entries[0]?.data, { value: 2 });
  assert.equal(entries[1]?.event, "invalid_json");
});

test("debug panel model formats recent log entries", () => {
  const model = debugPanelModel([
    {
      timestamp: "2026-01-01T12:34:56.000Z",
      event: "chat.complete",
      data: { usage: { totalTokens: 10 } }
    }
  ]);

  assert.equal(model.title, "DEBUG recent log entries");
  assert.equal(model.controls, "/debug toggles this view");
  assert.match(model.lines[0] ?? "", /12:34:56 chat\.complete/);
  assert.match(model.lines[0] ?? "", /totalTokens/);
});

test("loadConfig keeps shell environment values ahead of .env", async () => {
  const cwd = await mkdirTempWorkspace();
  const originalCwd = process.cwd();
  const keys = ["XAI_API_KEY", "GROK_API_KEY", "GROK_MODEL"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    await writeFile(path.join(cwd, ".env"), "XAI_API_KEY=from-dotenv\nGROK_MODEL=from-dotenv\n", "utf8");
    process.chdir(cwd);
    process.env.XAI_API_KEY = "from-shell";
    delete process.env.GROK_API_KEY;
    delete process.env.GROK_MODEL;

    const config = loadConfig();

    assert.equal(config.apiKey, "from-shell");
    assert.equal(config.apiKeySource, "XAI_API_KEY");
    assert.equal(config.model, "from-dotenv");
  } finally {
    process.chdir(originalCwd);
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

async function mkdirTempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "grokcode-ux-"));
}
