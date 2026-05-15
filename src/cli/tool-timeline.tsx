import { Box, Text } from "ink";

import type { ToolRuntimeEvent } from "../runtime/chat.js";
import { getTheme, type UiTheme } from "./theme.js";
import { compactToolSummary, sectionLabel, statusColor, statusLabel, truncateEnd, type UiColor } from "./ui-format.js";

interface ToolTimelineProps {
  events: readonly ToolRuntimeEvent[];
  expandedToolEventIds?: readonly string[];
  theme?: UiTheme;
}

export interface ToolTimelineItem {
  id: string;
  tool: string;
  label: string;
  color: UiColor;
  summary: string;
  expandable: boolean;
  details?: SearchResultDetails;
}

export function groupToolEvents(events: readonly ToolRuntimeEvent[]): ToolTimelineItem[] {
  const grouped = new Map<string, ToolRuntimeEvent[]>();

  for (const event of events) {
    grouped.set(event.id, [...(grouped.get(event.id) ?? []), event]);
  }

  return [...grouped.entries()].map(([id, group]) => {
    const latest = group[group.length - 1] as ToolRuntimeEvent;
    const details = searchResultDetails(latest);

    return {
      id,
      tool: latest.tool,
      label: statusLabel(latest.status, latest.result?.ok),
      color: statusColor(latest.status, latest.result?.ok),
      summary: compactToolSummary(latest),
      expandable: Boolean(details),
      ...(details ? { details } : {})
    };
  });
}

export function ToolTimeline({ events, expandedToolEventIds = [], theme = getTheme("dark") }: ToolTimelineProps) {
  const items = groupToolEvents(events);

  if (items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text color="magenta" bold>{sectionLabel("tools")}</Text>
      {items.map((item) => {
        const expanded = expandedToolEventIds.includes(item.id);

        return (
          <Box key={item.id} flexDirection="column">
            <Text color={item.color}>
              {item.tool} [{item.label}] {item.summary}
              {item.expandable && !expanded ? " (tab details)" : ""}
            </Text>
            {expanded && item.details && (
              <Box flexDirection="column" marginLeft={2}>
                <Text color={theme.muted}>{item.details.summary}</Text>
                {item.details.citations.map((citation, citationIndex) => (
                  <Text key={`${item.id}_citation_${citationIndex}`} color={theme.muted}>
                    source {citationIndex + 1}: {citation.title ? `${citation.title} ` : ""}{citation.url}
                  </Text>
                ))}
                {item.details.usage && (
                  <Text color={theme.muted}>
                    search tokens: prompt {item.details.usage.promptTokens ?? "?"}, completion{" "}
                    {item.details.usage.completionTokens ?? "?"}, total {item.details.usage.totalTokens ?? "?"}
                  </Text>
                )}
                {Boolean(item.details.rawToolUsage) && (
                  <Text color={theme.muted}>raw tool usage: {truncateEnd(JSON.stringify(item.details.rawToolUsage) ?? "", 160)}</Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
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

export interface SearchResultDetails {
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
