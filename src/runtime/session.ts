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
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
}

export interface SerializedSession {
  id: string;
  messages: SessionMessage[];
  createdAt: string;
  updatedAt: string;
}

export class Session {
  readonly id: string;
  readonly createdAt: string;
  private updatedAt: string;
  private readonly messages: SessionMessage[];

  constructor(seed?: SerializedSession) {
    this.id = seed?.id ?? createId("session");
    this.createdAt = seed?.createdAt ?? new Date().toISOString();
    this.updatedAt = seed?.updatedAt ?? this.createdAt;
    this.messages = seed?.messages ?? [
      {
        id: createId("message"),
        role: "system",
        content: SYSTEM_PROMPT,
        createdAt: this.createdAt
      }
    ];
  }

  listMessages(): readonly SessionMessage[] {
    return this.messages;
  }

  addUserMessage(content: string): SessionMessage {
    return this.addMessage("user", content);
  }

  addAssistantMessage(content: string, toolCalls?: ToolCallRequest[]): SessionMessage {
    return this.addMessage("assistant", content, { toolCalls });
  }

  addToolMessage(toolCallId: string, content: string): SessionMessage {
    return this.addMessage("tool", content, { toolCallId });
  }

  toChatMessages(contextPrompt?: string): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = this.messages.map((message): ChatCompletionMessageParam => {
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

    if (!contextPrompt) {
      return messages;
    }

    const systemIndex = messages.findIndex((message) => message.role === "system");
    const contextMessage: ChatCompletionMessageParam = {
      role: "system",
      content: contextPrompt
    };

    if (systemIndex < 0) {
      return [contextMessage, ...messages];
    }

    return [
      ...messages.slice(0, systemIndex + 1),
      contextMessage,
      ...messages.slice(systemIndex + 1)
    ];
  }

  serialize(): SerializedSession {
    return {
      id: this.id,
      messages: [...this.messages],
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
    options: { toolCalls?: ToolCallRequest[]; toolCallId?: string } = {}
  ): SessionMessage {
    const message = {
      id: createId("message"),
      role,
      content,
      createdAt: new Date().toISOString(),
      ...(options.toolCalls ? { toolCalls: options.toolCalls } : {}),
      ...(options.toolCallId ? { toolCallId: options.toolCallId } : {})
    };

    this.messages.push(message);
    this.updatedAt = message.createdAt;

    // TODO Phase 6: summarize older context once token budgeting exists.
    return message;
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
