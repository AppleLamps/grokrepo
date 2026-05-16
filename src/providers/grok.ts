import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from "openai/resources/chat/completions";

import type { ToolCallRequest } from "../tools/types.js";
import type { AppConfig } from "../utils/config.js";
import type { ConversationSummarizationInput, SummarizationResult } from "../runtime/summarization.js";
import { renderMessagesForSummarization } from "../runtime/summarization.js";

export interface GrokUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GrokStreamDelta {
  type: "content" | "tool_calls" | "usage";
  content?: string;
  toolCalls?: ToolCallRequest[];
  usage?: GrokUsage;
}

export interface GrokStreamOptions {
  signal?: AbortSignal;
}

export class GrokProvider {
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

  canCallApi(): boolean {
    return this.config.mock || Boolean(this.client);
  }

  async summarizeConversation(input: ConversationSummarizationInput): Promise<SummarizationResult> {
    if (this.config.mock) {
      return {
        ok: true,
        summary: createMockSummary(input)
      };
    }

    if (!this.client) {
      return {
        ok: false,
        error: {
          code: "missing_api_key",
          message: "Missing XAI_API_KEY. Conversation summarization was skipped."
        }
      };
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: [
              "You summarize older turns for a terminal coding assistant.",
              "Preserve user goals, decisions, files touched, commands run, approvals, denials, tool results, errors, unresolved tasks, and constraints.",
              "Do not invent facts. Do not request tools. Keep the summary compact and operational."
            ].join("\n")
          },
          {
            role: "user",
            content: renderSummarizationPrompt(input)
          }
        ]
      });

      const summary = response.choices[0]?.message.content?.trim();

      if (!summary) {
        return {
          ok: false,
          error: {
            code: "empty_summary",
            message: "Conversation summarization returned no content."
          }
        };
      }

      return {
        ok: true,
        summary,
        ...(response.usage
          ? {
              usage: {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens
              }
            }
          : {})
      };
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "summary_failed",
          message: cause instanceof Error ? cause.message : String(cause)
        }
      };
    }
  }

  async *streamChat(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[] = [],
    options: GrokStreamOptions = {}
  ): AsyncGenerator<GrokStreamDelta> {
    throwIfAborted(options.signal);

    if (this.config.mock) {
      yield* this.streamMockResponse(messages, options.signal);
      return;
    }

    if (!this.client) {
      throw new Error("Missing XAI_API_KEY. Add it to .env, or set GROKCODE_MOCK=true for local verification.");
    }

    const stream = await this.client.chat.completions.create(
      {
        model: this.config.model,
        messages,
        ...(tools.length > 0
          ? {
              tools,
              tool_choice: "auto" as const
            }
          : {}),
        parallel_tool_calls: false,
        stream: true,
        stream_options: {
          include_usage: true
        }
      },
      options.signal ? { signal: options.signal } : undefined
    );

    const toolCallAccumulator = new ToolCallAccumulator();

    for await (const chunk of stream) {
      throwIfAborted(options.signal);
      for (const event of parseChunk(chunk, toolCallAccumulator)) {
        yield event;
      }
    }

    const toolCalls = toolCallAccumulator.toToolCalls();
    if (toolCalls.length > 0) {
      yield {
        type: "tool_calls",
        toolCalls
      };
    }
  }

  private async *streamMockResponse(
    messages: ChatCompletionMessageParam[],
    signal?: AbortSignal
  ): AsyncGenerator<GrokStreamDelta> {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content;
    const response = `Mock Grok response received: ${typeof lastUserMessage === "string" ? lastUserMessage : ""}`;

    for (const token of response.split(/(\s+)/).filter(Boolean)) {
      await delay(15, signal);
      throwIfAborted(signal);
      yield {
        type: "content",
        content: token
      };
    }

    yield {
      type: "usage",
      usage: {
        promptTokens: estimateTokens(messages.map((message) => message.content).join("\n")),
        completionTokens: estimateTokens(response),
        totalTokens: estimateTokens(`${messages.map((message) => message.content).join("\n")}\n${response}`)
      }
    };
  }
}

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function* parseChunk(chunk: ChatCompletionChunk, toolCallAccumulator: ToolCallAccumulator): Generator<GrokStreamDelta> {
  const choice = chunk.choices[0];
  const content = choice?.delta.content;

  if (typeof content === "string" && content.length > 0) {
    yield {
      type: "content",
      content
    };
  }

  if (choice?.delta.tool_calls && choice.delta.tool_calls.length > 0) {
    toolCallAccumulator.add(choice.delta.tool_calls);
  }

  if (chunk.usage) {
    yield {
      type: "usage",
      usage: {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens
      }
    };
  }
}

interface PartialToolCall {
  id?: string;
  name: string;
  arguments: string;
}

class ToolCallAccumulator {
  private readonly calls = new Map<number, PartialToolCall>();

  add(toolCalls: NonNullable<ChatCompletionChunk.Choice.Delta["tool_calls"]>): void {
    for (const toolCall of toolCalls) {
      const current = this.calls.get(toolCall.index) ?? { name: "", arguments: "" };

      if (toolCall.id) {
        current.id = toolCall.id;
      }

      if (toolCall.function?.name) {
        current.name += toolCall.function.name;
      }

      if (toolCall.function?.arguments) {
        current.arguments += toolCall.function.arguments;
      }

      this.calls.set(toolCall.index, current);
    }
  }

  toToolCalls(): ToolCallRequest[] {
    return [...this.calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id ?? `tool_call_${index}`,
        name: call.name,
        arguments: call.arguments
      }))
      .filter((call) => call.name.length > 0);
  }
}

export function toAssistantToolCalls(toolCalls: ToolCallRequest[]): ChatCompletionAssistantMessageParam["tool_calls"] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments
    }
  }));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error("Operation aborted.");
  error.name = "AbortError";
  return error;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function renderSummarizationPrompt(input: ConversationSummarizationInput): string {
  return [
    `<target_tokens>${input.targetTokenBudget}</target_tokens>`,
    input.previousSummary
      ? `<previous_summary>\n${input.previousSummary.text}\n</previous_summary>`
      : "<previous_summary>none</previous_summary>",
    `<messages>\n${renderMessagesForSummarization(input.messages)}\n</messages>`
  ].join("\n\n");
}

function createMockSummary(input: ConversationSummarizationInput): string {
  const prior = input.previousSummary?.text ? `Previous summary: ${input.previousSummary.text}` : "Previous summary: none";
  const messageLines = input.messages.map((message) => {
    const compactContent = message.content.replace(/\s+/g, " ").slice(0, 120);
    return `${message.role}(${message.id}): ${compactContent}`;
  });
  const summary = [
    "Mock conversation summary.",
    prior,
    `Covered messages: ${input.messages.length}.`,
    ...messageLines
  ].join("\n");
  const maxChars = input.targetTokenBudget * 4;

  return summary.length > maxChars ? summary.slice(0, maxChars) : summary;
}
