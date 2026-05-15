import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { toAssistantToolCalls } from "../providers/grok.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import type { ToolCallRequest } from "../tools/types.js";

export type SessionRole = "system" | "user" | "assistant" | "tool";

export interface SessionMessage {
  id: string;
  role: SessionRole;
  content: string;
  createdAt: string;
  turnId?: string;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
}

export interface ConversationSummary {
  id: string;
  text: string;
  coveredMessageIds: string[];
  sourceMessageCount: number;
  estimatedTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedSession {
  id: string;
  messages: SessionMessage[];
  summary?: ConversationSummary;
  createdAt: string;
  updatedAt: string;
}

export class Session {
  readonly id: string;
  readonly createdAt: string;
  private updatedAt: string;
  private readonly messages: SessionMessage[];
  private summary?: ConversationSummary;
  private currentTurnId?: string;

  constructor(seed?: SerializedSession) {
    this.id = seed?.id ?? createId("session");
    this.createdAt = seed?.createdAt ?? new Date().toISOString();
    this.updatedAt = seed?.updatedAt ?? this.createdAt;
    this.messages = seed?.messages ? normalizeSeedMessages(seed.messages) : [
      {
        id: createId("message"),
        role: "system",
        content: SYSTEM_PROMPT,
        createdAt: this.createdAt
      }
    ];
    this.summary = seed?.summary;
    this.currentTurnId = [...this.messages].reverse().find((message) => message.turnId)?.turnId;
  }

  listMessages(): readonly SessionMessage[] {
    return this.messages;
  }

  addUserMessage(content: string): SessionMessage {
    this.currentTurnId = createId("turn");
    return this.addMessage("user", content, { turnId: this.currentTurnId });
  }

  addAssistantMessage(content: string, toolCalls?: ToolCallRequest[]): SessionMessage {
    return this.addMessage("assistant", content, { toolCalls, turnId: this.ensureTurnId() });
  }

  addToolMessage(toolCallId: string, content: string): SessionMessage {
    return this.addMessage("tool", content, { toolCallId, turnId: this.ensureTurnId() });
  }

  getConversationSummary(): ConversationSummary | undefined {
    return this.summary;
  }

  setConversationSummary(summary: ConversationSummary): void {
    this.summary = summary;
    this.updatedAt = summary.updatedAt;
  }

  activeMessages(): readonly SessionMessage[] {
    const coveredIds = new Set(this.summary?.coveredMessageIds ?? []);
    return this.messages.filter((message) => message.role === "system" || !coveredIds.has(message.id));
  }

  toChatMessages(contextPrompt?: string): ChatCompletionMessageParam[] {
    const coveredIds = new Set(this.summary?.coveredMessageIds ?? []);
    const messages: ChatCompletionMessageParam[] = this.messages
      .filter((message) => message.role === "system" || !coveredIds.has(message.id))
      .map((message): ChatCompletionMessageParam => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId ?? message.id
        };
      }

      if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: message.content.length > 0 ? message.content : null,
          tool_calls: toAssistantToolCalls(message.toolCalls)
        } as ChatCompletionMessageParam;
      }

      return {
        role: message.role,
        content: message.content
      };
    });

    const insertedSystemMessages = [
      contextPrompt,
      this.summary ? renderConversationSummaryPrompt(this.summary) : undefined
    ].filter((prompt): prompt is string => Boolean(prompt));

    if (insertedSystemMessages.length === 0) {
      return messages;
    }

    const systemIndex = messages.findIndex((message) => message.role === "system");
    const extraMessages: ChatCompletionMessageParam[] = insertedSystemMessages.map((content) => ({
      role: "system",
      content
    }));

    if (systemIndex < 0) {
      return [...extraMessages, ...messages];
    }

    return [
      ...messages.slice(0, systemIndex + 1),
      ...extraMessages,
      ...messages.slice(systemIndex + 1)
    ];
  }

  serialize(): SerializedSession {
    return {
      id: this.id,
      messages: [...this.messages],
      ...(this.summary ? { summary: this.summary } : {}),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  async save(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(this.serialize(), null, 2)}\n`, "utf8");
  }

  static async restore(path: string): Promise<Session> {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as SerializedSession;
    return new Session(parsed);
  }

  private addMessage(
    role: SessionRole,
    content: string,
    options: { toolCalls?: ToolCallRequest[]; toolCallId?: string; turnId?: string } = {}
  ): SessionMessage {
    const message = {
      id: createId("message"),
      role,
      content,
      createdAt: new Date().toISOString(),
      ...(options.turnId && role !== "system" ? { turnId: options.turnId } : {}),
      ...(options.toolCalls ? { toolCalls: options.toolCalls } : {}),
      ...(options.toolCallId ? { toolCallId: options.toolCallId } : {})
    };

    this.messages.push(message);
    this.updatedAt = message.createdAt;

    return message;
  }

  private ensureTurnId(): string {
    this.currentTurnId ??= createId("turn");
    return this.currentTurnId;
  }
}

function renderConversationSummaryPrompt(summary: ConversationSummary): string {
  return [
    "<conversation_summary>",
    "Purpose: compact summary of earlier conversation turns.",
    "Rules: treat this as memory, use tools before exact claims or edits.",
    `sourceMessageCount: ${summary.sourceMessageCount}`,
    `coveredMessageIds: ${summary.coveredMessageIds.join(", ")}`,
    summary.text
  ].join("\n");
}

function normalizeSeedMessages(messages: SessionMessage[]): SessionMessage[] {
  let currentTurnId: string | undefined;

  return messages.map((message) => {
    if (message.role === "system") {
      return { ...message };
    }

    if (message.turnId) {
      currentTurnId = message.turnId;
      return { ...message };
    }

    if (message.role === "user" || !currentTurnId) {
      currentTurnId = createId("turn");
    }

    return {
      ...message,
      turnId: currentTurnId
    };
  });
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
