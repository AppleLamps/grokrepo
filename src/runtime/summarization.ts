import { estimateTokens } from "../context/index.js";
import type { GrokUsage } from "../providers/grok.js";
import type { ConversationSummary, Session, SessionMessage } from "./session.js";

export interface SummarizationOptions {
  triggerTokenThreshold: number;
  targetTokenBudget: number;
  retainRecentTurns: number;
}

export interface ConversationSummarizationInput {
  previousSummary?: ConversationSummary;
  messages: SessionMessage[];
  targetTokenBudget: number;
}

export interface SummarizationResult {
  ok: boolean;
  summary?: string;
  usage?: GrokUsage;
  error?: {
    code: string;
    message: string;
  };
}

export interface ConversationSummarizer {
  summarizeConversation(input: ConversationSummarizationInput): Promise<SummarizationResult>;
}

export interface ContextRuntimeMetadata {
  repoContext?: {
    estimatedTokens: number;
    truncated: boolean;
    itemCount: number;
  };
  conversationSummary: {
    activeTokensBefore: number;
    attempted: boolean;
    summarized: boolean;
    retainedTurns: number;
    coveredMessageCount: number;
    estimatedTokens?: number;
    error?: {
      code: string;
      message: string;
    };
  };
}

export const DEFAULT_SUMMARIZATION_OPTIONS: SummarizationOptions = {
  triggerTokenThreshold: 150_000,
  targetTokenBudget: 2_000,
  retainRecentTurns: 6
};

export async function summarizeSessionIfNeeded(
  session: Session,
  summarizer: ConversationSummarizer | undefined,
  options: Partial<SummarizationOptions> = {}
): Promise<ContextRuntimeMetadata["conversationSummary"]> {
  const resolvedOptions = {
    ...DEFAULT_SUMMARIZATION_OPTIONS,
    ...options
  };
  const activeMessages = session.activeMessages().filter((message) => message.role !== "system");
  const activeTokensBefore = estimateTokens(activeMessages.map(renderMessageForSummary).join("\n\n"));
  const turnGroups = groupMessagesByTurn(activeMessages);

  const baseMetadata: ContextRuntimeMetadata["conversationSummary"] = {
    activeTokensBefore,
    attempted: false,
    summarized: false,
    retainedTurns: Math.min(turnGroups.length, resolvedOptions.retainRecentTurns),
    coveredMessageCount: session.getConversationSummary()?.coveredMessageIds.length ?? 0
  };

  if (activeTokensBefore <= resolvedOptions.triggerTokenThreshold) {
    return baseMetadata;
  }

  const summarizableGroups = turnGroups.slice(0, Math.max(0, turnGroups.length - resolvedOptions.retainRecentTurns));
  const messagesToSummarize = summarizableGroups.flat();

  if (!summarizer || messagesToSummarize.length === 0) {
    return {
      ...baseMetadata,
      attempted: Boolean(summarizer),
      error: messagesToSummarize.length === 0
        ? { code: "no_complete_turns", message: "No complete older turns are available to summarize." }
        : { code: "summarizer_unavailable", message: "Conversation summarizer is unavailable." }
    };
  }

  const result = await summarizer.summarizeConversation({
    previousSummary: session.getConversationSummary(),
    messages: messagesToSummarize,
    targetTokenBudget: resolvedOptions.targetTokenBudget
  });

  if (!result.ok || !result.summary) {
    return {
      ...baseMetadata,
      attempted: true,
      error: result.error ?? { code: "summary_failed", message: "Conversation summarization failed." }
    };
  }

  const now = new Date().toISOString();
  const previousCoveredIds = session.getConversationSummary()?.coveredMessageIds ?? [];
  const coveredMessageIds = [...new Set([...previousCoveredIds, ...messagesToSummarize.map((message) => message.id)])];
  const estimatedTokens = estimateTokens(result.summary);

  session.setConversationSummary({
    id: session.getConversationSummary()?.id ?? createSummaryId(),
    text: result.summary,
    coveredMessageIds,
    sourceMessageCount: coveredMessageIds.length,
    estimatedTokens,
    createdAt: session.getConversationSummary()?.createdAt ?? now,
    updatedAt: now
  });

  return {
    ...baseMetadata,
    attempted: true,
    summarized: true,
    coveredMessageCount: coveredMessageIds.length,
    estimatedTokens
  };
}

export function renderMessagesForSummarization(messages: readonly SessionMessage[]): string {
  return messages.map(renderMessageForSummary).join("\n\n");
}

function groupMessagesByTurn(messages: SessionMessage[]): SessionMessage[][] {
  const groups: SessionMessage[][] = [];
  const groupIndexes = new Map<string, number>();

  for (const message of messages) {
    const turnId = message.turnId ?? message.id;
    let index = groupIndexes.get(turnId);

    if (index === undefined) {
      index = groups.length;
      groupIndexes.set(turnId, index);
      groups.push([]);
    }

    groups[index]?.push(message);
  }

  return groups;
}

function renderMessageForSummary(message: SessionMessage): string {
  const toolCalls = message.toolCalls && message.toolCalls.length > 0
    ? `\ntoolCalls: ${JSON.stringify(message.toolCalls)}`
    : "";
  const toolCallId = message.toolCallId ? `\ntoolCallId: ${message.toolCallId}` : "";

  return [
    `id: ${message.id}`,
    `turnId: ${message.turnId ?? "none"}`,
    `role: ${message.role}`,
    `createdAt: ${message.createdAt}`,
    `content:\n${message.content}${toolCalls}${toolCallId}`
  ].join("\n");
}

function createSummaryId(): string {
  return `summary_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
