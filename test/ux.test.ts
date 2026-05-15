import assert from "node:assert/strict";
import test from "node:test";

import { diffLineColor, renderDiffLines } from "../src/cli/diff-renderer.js";
import { isExpandableSearchEvent, searchResultDetails } from "../src/cli/output.js";
import type { ToolRuntimeEvent } from "../src/runtime/chat.js";

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
