import OpenAI from "openai";
import type { Response, ResponseOutputText, ResponseUsage } from "openai/resources/responses/responses";

import { toolFailure, toolSuccess, type ToolExecutionResult } from "../tools/types.js";
import type { AppConfig } from "../utils/config.js";

export interface SearchCitation {
  title: string;
  url: string;
  startIndex?: number;
  endIndex?: number;
}

export interface SearchUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface SearchResult {
  query: string;
  summary: string;
  citations: SearchCitation[];
  usage?: SearchUsage;
  rawToolUsage?: unknown;
}

export interface WebSearchRequest {
  query: string;
  allowedDomains?: string[];
  excludedDomains?: string[];
  enableImageUnderstanding?: boolean;
}

export interface XSearchRequest {
  query: string;
  allowedXHandles?: string[];
  excludedXHandles?: string[];
  fromDate?: string;
  toDate?: string;
  enableImageUnderstanding?: boolean;
  enableVideoUnderstanding?: boolean;
}

export class SearchProvider {
  private readonly client?: OpenAI;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;

    if (!config.mock && config.apiKey) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: 360_000
      });
    }
  }

  async runWebSearch(args: unknown): Promise<ToolExecutionResult<SearchResult>> {
    const request = args as WebSearchRequest;

    if (!this.client) {
      return searchFailure("web_search", "missing_api_key", "Missing XAI_API_KEY. Add it to .env before using search.");
    }

    try {
      const tool = buildWebSearchTool(request);
      const response = await this.client.responses.create({
        model: this.config.model,
        input: [{ role: "user", content: request.query }],
        tools: [tool]
      } as never) as Response;

      return toolSuccess("web_search", normalizeSearchResponse("web_search", request.query, response));
    } catch (cause) {
      return searchFailure("web_search", "search_failed", errorMessage(cause));
    }
  }

  async runXSearch(args: unknown): Promise<ToolExecutionResult<SearchResult>> {
    const request = args as XSearchRequest;

    if (!this.client) {
      return searchFailure("x_search", "missing_api_key", "Missing XAI_API_KEY. Add it to .env before using search.");
    }

    try {
      const tool = buildXSearchTool(request);
      const response = await this.client.responses.create({
        model: this.config.model,
        input: [{ role: "user", content: request.query }],
        tools: [tool]
      } as never) as Response;

      return toolSuccess("x_search", normalizeSearchResponse("x_search", request.query, response));
    } catch (cause) {
      return searchFailure("x_search", "search_failed", errorMessage(cause));
    }
  }
}

export function normalizeSearchResponse(tool: string, query: string, response: Response): SearchResult {
  const outputText = response.output_text?.trim() ?? "";
  const citations = extractCitations(response);
  const usage = normalizeUsage(response.usage);
  const rawToolUsage = (response as unknown as { server_side_tool_usage?: unknown }).server_side_tool_usage;

  return {
    query,
    summary: outputText.length > 0 ? outputText : `${tool} returned no summary.`,
    citations,
    ...(usage ? { usage } : {}),
    ...(rawToolUsage ? { rawToolUsage } : {})
  };
}

function buildWebSearchTool(request: WebSearchRequest): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: "web_search"
  };

  if (request.allowedDomains) {
    tool.filters = {
      allowed_domains: request.allowedDomains
    };
  }

  if (request.excludedDomains) {
    tool.filters = {
      excluded_domains: request.excludedDomains
    };
  }

  if (request.enableImageUnderstanding !== undefined) {
    tool.enable_image_understanding = request.enableImageUnderstanding;
  }

  return tool;
}

function buildXSearchTool(request: XSearchRequest): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: "x_search"
  };

  if (request.allowedXHandles) {
    tool.allowed_x_handles = request.allowedXHandles;
  }

  if (request.excludedXHandles) {
    tool.excluded_x_handles = request.excludedXHandles;
  }

  if (request.fromDate) {
    tool.from_date = request.fromDate;
  }

  if (request.toDate) {
    tool.to_date = request.toDate;
  }

  if (request.enableImageUnderstanding !== undefined) {
    tool.enable_image_understanding = request.enableImageUnderstanding;
  }

  if (request.enableVideoUnderstanding !== undefined) {
    tool.enable_video_understanding = request.enableVideoUnderstanding;
  }

  return tool;
}

function extractCitations(response: Response): SearchCitation[] {
  const citations = new Map<string, SearchCitation>();

  for (const item of response.output) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content) {
      if (content.type !== "output_text") {
        continue;
      }

      for (const annotation of content.annotations) {
        if (annotation.type !== "url_citation") {
          continue;
        }

        const citation = annotation as ResponseOutputText.URLCitation;
        citations.set(citation.url, {
          title: citation.title,
          url: citation.url,
          startIndex: citation.start_index,
          endIndex: citation.end_index
        });
      }
    }
  }

  const responseCitations = (response as unknown as { citations?: Array<{ title?: string; url?: string }> }).citations;

  if (Array.isArray(responseCitations)) {
    for (const citation of responseCitations) {
      if (typeof citation.url === "string" && !citations.has(citation.url)) {
        citations.set(citation.url, {
          title: citation.title ?? citation.url,
          url: citation.url
        });
      }
    }
  }

  return [...citations.values()];
}

function normalizeUsage(usage: ResponseUsage | undefined): SearchUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.total_tokens
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function searchFailure(tool: string, code: string, message: string): ToolExecutionResult<SearchResult> {
  return toolFailure(tool, code, message) as ToolExecutionResult<SearchResult>;
}
