import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "openai/resources/responses/responses";

import { normalizeSearchResponse, SearchProvider } from "../src/providers/search.js";
import { createDefaultToolRegistry } from "../src/tools/index.js";
import { toolSuccess, type SearchProviderLike } from "../src/tools/types.js";

test("web_search validates mutually exclusive filters", async () => {
  const tool = createDefaultToolRegistry().get("web_search");
  assert.ok(tool);

  const result = await tool.execute(
    {
      query: "xAI",
      allowedDomains: ["x.ai"],
      excludedDomains: ["example.com"]
    },
    { cwd: process.cwd(), searchProvider: createSearchProvider() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("web_search validates max domain filters", async () => {
  const tool = createDefaultToolRegistry().get("web_search");
  assert.ok(tool);

  const result = await tool.execute(
    {
      query: "xAI",
      allowedDomains: ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"]
    },
    { cwd: process.cwd(), searchProvider: createSearchProvider() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("x_search validates mutually exclusive handle filters", async () => {
  const tool = createDefaultToolRegistry().get("x_search");
  assert.ok(tool);

  const result = await tool.execute(
    {
      query: "xAI",
      allowedXHandles: ["xai"],
      excludedXHandles: ["elonmusk"]
    },
    { cwd: process.cwd(), searchProvider: createSearchProvider() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("x_search validates max handle filters", async () => {
  const tool = createDefaultToolRegistry().get("x_search");
  assert.ok(tool);

  const result = await tool.execute(
    {
      query: "xAI",
      allowedXHandles: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]
    },
    { cwd: process.cwd(), searchProvider: createSearchProvider() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("x_search validates ISO date format", async () => {
  const tool = createDefaultToolRegistry().get("x_search");
  assert.ok(tool);

  const result = await tool.execute(
    {
      query: "xAI",
      fromDate: "01-01-2026"
    },
    { cwd: process.cwd(), searchProvider: createSearchProvider() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("search tools return missing_api_key without configured provider", async () => {
  const tool = createDefaultToolRegistry().get("web_search");
  assert.ok(tool);

  const result = await tool.execute({ query: "xAI" }, { cwd: process.cwd() });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "missing_api_key");
});

test("SearchProvider returns missing_api_key when API key is absent", async () => {
  const provider = new SearchProvider({
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    imageModel: "grok-imagine-image-quality",
    mock: false
  });

  const result = await provider.runWebSearch({ query: "xAI" });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "missing_api_key");
});

test("normalizeSearchResponse extracts citations and usage", () => {
  const response = {
    output_text: "xAI has docs.",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "xAI has docs.",
            annotations: [
              {
                type: "url_citation",
                title: "xAI Docs",
                url: "https://docs.x.ai",
                start_index: 0,
                end_index: 3
              }
            ]
          }
        ]
      }
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15
    }
  } as Response;

  const result = normalizeSearchResponse("web_search", "xAI docs", response);

  assert.equal(result.summary, "xAI has docs.");
  assert.deepEqual(result.citations, [
    {
      title: "xAI Docs",
      url: "https://docs.x.ai",
      startIndex: 0,
      endIndex: 3
    }
  ]);
  assert.deepEqual(result.usage, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15
  });
});

function createSearchProvider(): SearchProviderLike {
  return {
    async runWebSearch() {
      return toolSuccess("web_search", {
        query: "xAI",
        summary: "web",
        citations: []
      });
    },
    async runXSearch() {
      return toolSuccess("x_search", {
        query: "xAI",
        summary: "x",
        citations: []
      });
    }
  };
}
