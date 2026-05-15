import { Box, Text } from "ink";

import type { GrokUsage } from "../providers/grok.js";
import type { ToolApprovalRequest, ToolRuntimeEvent } from "../runtime/chat.js";
import type { SessionMessage } from "../runtime/session.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import { renderDiffLines } from "./diff-renderer.js";

interface ChatOutputProps {
  messages: readonly SessionMessage[];
  toolEvents: readonly ToolRuntimeEvent[];
  pendingApproval?: ToolApprovalRequest;
  selectedApprovalFiles?: readonly string[];
  expandedToolEventIds?: readonly string[];
  error?: string;
  usage?: GrokUsage;
  contextMetadata?: ContextRuntimeMetadata;
}

export function ChatOutput({
  messages,
  toolEvents,
  pendingApproval,
  selectedApprovalFiles = [],
  expandedToolEventIds = [],
  error,
  usage,
  contextMetadata
}: ChatOutputProps) {
  const visibleMessages = messages.filter(
    (message) => message.role !== "system" && message.role !== "tool" && message.content.length > 0
  );

  return (
    <Box flexDirection="column" gap={1}>
      {visibleMessages.map((message) => (
        <Box key={message.id} flexDirection="column">
          <Text color={message.role === "user" ? "green" : "cyan"}>
            {message.role === "user" ? "You" : "GrokCode"}
          </Text>
          <Text>{message.content}</Text>
        </Box>
      ))}

      {toolEvents.length > 0 && (
        <Box flexDirection="column">
          {toolEvents.map((event, index) => {
            const eventKey = `${event.id}_${event.status}_${index}`;
            const expanded = expandedToolEventIds.includes(event.id);
            const details = searchResultDetails(event);

            return (
              <Box key={eventKey} flexDirection="column">
                <Text color={toolColor(event)}>
                  tool {event.tool}: {toolStatusText(event)}
                  {isExpandableSearchEvent(event) && !expanded ? " (tab for details)" : ""}
                </Text>
                {expanded && details && (
                  <Box flexDirection="column" marginLeft={2}>
                    <Text color="gray">{details.summary}</Text>
                    {details.citations.map((citation, citationIndex) => (
                      <Text key={`${eventKey}_citation_${citationIndex}`} color="gray">
                        source {citationIndex + 1}: {citation.title ? `${citation.title} ` : ""}{citation.url}
                      </Text>
                    ))}
                    {details.usage && (
                      <Text color="gray">
                        search tokens: prompt {details.usage.promptTokens ?? "?"}, completion{" "}
                        {details.usage.completionTokens ?? "?"}, total {details.usage.totalTokens ?? "?"}
                      </Text>
                    )}
                    {Boolean(details.rawToolUsage) && <Text color="gray">raw tool usage: {JSON.stringify(details.rawToolUsage) ?? ""}</Text>}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {pendingApproval && (
        <Box flexDirection="column">
          <Text color="yellow">Approve {pendingApproval.tool.name}?</Text>
          {pendingApproval.summary && <Text>{pendingApproval.summary}</Text>}
          <Text>{pendingApproval.preview}</Text>
          {pendingApproval.kind === "patch" && pendingApproval.files && pendingApproval.files.length > 0 && (
            <Box flexDirection="column">
              {pendingApproval.files.map((file, index) => (
                <Text key={file} color={selectedApprovalFiles.includes(file) ? "green" : "gray"}>
                  {index + 1}. {selectedApprovalFiles.includes(file) ? "[x]" : "[ ]"} {file}
                </Text>
              ))}
              {pendingApproval.diff && <RenderedDiff diff={pendingApproval.diff} />}
              <Text color="gray">Press 1-9 to toggle files, enter/y to apply selected, a for all, s to skip all, n to deny.</Text>
            </Box>
          )}
          {pendingApproval.kind !== "patch" && <Text color="gray">Press y to allow, n to deny.</Text>}
        </Box>
      )}

      {usage && (
        <Text color="gray">
          tokens: prompt {usage.promptTokens ?? "?"}, completion {usage.completionTokens ?? "?"}, total{" "}
          {usage.totalTokens ?? "?"}
        </Text>
      )}

      {contextMetadata && <ContextStatus metadata={contextMetadata} />}

      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

function ContextStatus({ metadata }: { metadata: ContextRuntimeMetadata }) {
  const summary = metadata.conversationSummary;
  const repo = metadata.repoContext;
  const parts = [
    repo ? `repo ${repo.estimatedTokens}t${repo.truncated ? " truncated" : ""}` : undefined,
    summary.summarized
      ? `summarized ${summary.coveredMessageCount} old message(s) into ${summary.estimatedTokens ?? "?"}t`
      : summary.error
        ? `summary skipped (${summary.error.code})`
        : undefined
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return null;
  }

  return <Text color="gray">context: {parts.join(", ")}</Text>;
}

function RenderedDiff({ diff }: { diff: string }) {
  const rendered = renderDiffLines(diff);

  return (
    <Box flexDirection="column">
      {rendered.lines.map((line, index) => (
        <Text key={`${index}_${line.text}`} color={line.color}>
          {line.text}
        </Text>
      ))}
      {rendered.remaining > 0 && <Text color="gray">... {rendered.remaining} more diff line(s)</Text>}
    </Box>
  );
}

function toolColor(event: ToolRuntimeEvent): "gray" | "cyan" | "yellow" | "green" | "red" {
  if (event.status === "completed") {
    return event.result?.ok ? "green" : "red";
  }

  if (event.status === "approval_requested") {
    return "yellow";
  }

  if (event.status === "running") {
    return "cyan";
  }

  return "gray";
}

function toolStatusText(event: ToolRuntimeEvent): string {
  if (event.status === "completed") {
    if (!event.result?.ok) {
      return `failed (${event.result?.error?.code ?? "unknown_error"})`;
    }

    const details = searchResultDetails(event);
    return details ? `completed (${details.citations.length} source${details.citations.length === 1 ? "" : "s"})` : "completed";
  }

  if (event.status === "denied") {
    return "denied";
  }

  return event.status.replaceAll("_", " ");
}

export function isExpandableSearchEvent(event: ToolRuntimeEvent): boolean {
  return Boolean(searchResultDetails(event));
}

export function searchResultDetails(event: ToolRuntimeEvent): SearchResultDetails | undefined {
  if (event.status !== "completed" || !event.result?.ok || !["web_search", "x_search"].includes(event.tool)) {
    return undefined;
  }

  const output = event.result.output;

  if (!isRecord(output) || typeof output.summary !== "string") {
    return undefined;
  }

  return {
    summary: output.summary,
    citations: Array.isArray(output.citations)
      ? output.citations.filter(isCitation).map((citation) => ({
          title: typeof citation.title === "string" ? citation.title : undefined,
          url: citation.url
        }))
      : [],
    usage: isRecord(output.usage)
      ? {
          promptTokens: typeof output.usage.promptTokens === "number" ? output.usage.promptTokens : undefined,
          completionTokens: typeof output.usage.completionTokens === "number" ? output.usage.completionTokens : undefined,
          totalTokens: typeof output.usage.totalTokens === "number" ? output.usage.totalTokens : undefined
        }
      : undefined,
    rawToolUsage: output.rawToolUsage
  };
}

interface SearchResultDetails {
  summary: string;
  citations: Array<{ title?: string; url: string }>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  rawToolUsage?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCitation(value: unknown): value is { title?: unknown; url: string } {
  return isRecord(value) && typeof value.url === "string";
}
