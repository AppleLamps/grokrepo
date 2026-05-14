import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from "openai/resources/chat/completions";

import type { ToolCallRequest } from "../tools/types.js";
import type { AppConfig } from "../utils/config.js";

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

  async *streamChat(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[] = []
  ): AsyncGenerator<GrokStreamDelta> {
    if (this.config.mock) {
      yield* this.streamMockResponse(messages);
      return;
    }

    if (!this.client) {
      throw new Error("Missing XAI_API_KEY. Add it to .env, or set GROKCODE_MOCK=true for local verification.");
    }

    const stream = await this.client.chat.completions.create({
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
    });

    const toolCallAccumulator = new ToolCallAccumulator();

    for await (const chunk of stream) {
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
    messages: ChatCompletionMessageParam[]
  ): AsyncGenerator<GrokStreamDelta> {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content;
    const response = `Mock Grok response received: ${typeof lastUserMessage === "string" ? lastUserMessage : ""}`;

    for (const token of response.split(/(\s+)/).filter(Boolean)) {
      await delay(15);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
