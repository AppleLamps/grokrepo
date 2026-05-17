import { Box, Text } from "ink";

import type { ToolRuntimeEvent } from "../runtime/chat.js";
import type { SessionMessage } from "../runtime/session.js";
import type { ToolCallRequest } from "../tools/types.js";
import { MarkdownText } from "./markdown.js";
import { getTheme, type UiTheme } from "./theme.js";
import { compactToolSummary, sectionLabel, separator, statusColor, statusLabel } from "./ui-format.js";

interface MessageListProps {
  messages: readonly SessionMessage[];
  toolEvents?: readonly ToolRuntimeEvent[];
  expandedToolEventIds?: readonly string[];
  busy?: boolean;
  theme?: UiTheme;
}

export interface MessageListItem {
  message: SessionMessage;
  placeholder: boolean;
}

export type TranscriptItem =
  | { type: "message"; message: SessionMessage; placeholder: boolean }
  | { type: "tool"; id: string; event?: ToolRuntimeEvent; call?: ToolCallRequest; message?: SessionMessage };

export function messageListItems(messages: readonly SessionMessage[], busy = false): MessageListItem[] {
  const tail = messages[messages.length - 1];

  return messages
    .filter((message) => {
      if (message.role === "system" || message.role === "tool") {
        return false;
      }

      return message.content.length > 0 || (busy && message.role === "assistant" && message.id === tail?.id);
    })
    .map((message) => ({
      message,
      placeholder: message.content.length === 0
    }));
}

export function transcriptItems(
  messages: readonly SessionMessage[],
  toolEvents: readonly ToolRuntimeEvent[] = [],
  busy = false
): TranscriptItem[] {
  const tail = messages[messages.length - 1];
  const items: TranscriptItem[] = [];
  const toolEventById = new Map(toolEvents.map((event) => [event.id, event]));
  const toolMessages = new Map<string, SessionMessage>();
  const renderedToolIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) {
      toolMessages.set(message.toolCallId, message);
    }
  }

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool") {
      if (!message.toolCallId || renderedToolIds.has(message.toolCallId)) {
        continue;
      }

      items.push({
        type: "tool",
        id: message.toolCallId,
        event: toolEventById.get(message.toolCallId),
        message
      });
      renderedToolIds.add(message.toolCallId);
      continue;
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      if (message.content.length > 0 || (busy && message.id === tail?.id)) {
        items.push({ type: "message", message, placeholder: message.content.length === 0 });
      }

      for (const call of message.toolCalls) {
        items.push({
          type: "tool",
          id: call.id,
          call,
          event: toolEventById.get(call.id),
          message: toolMessages.get(call.id)
        });
        renderedToolIds.add(call.id);
      }
      continue;
    }

    if (message.content.length > 0 || (busy && message.role === "assistant" && message.id === tail?.id)) {
      items.push({ type: "message", message, placeholder: message.content.length === 0 });
    }
  }

  for (const event of toolEvents) {
    if (!renderedToolIds.has(event.id)) {
      items.push({ type: "tool", id: event.id, event });
    }
  }

  return items;
}

export function MessageList({
  messages,
  toolEvents = [],
  expandedToolEventIds = [],
  busy = false,
  theme = getTheme("dark")
}: MessageListProps) {
  const visibleItems = transcriptItems(messages, toolEvents, busy);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, index) => {
        const key = item.type === "message" ? item.message.id : `tool_${item.id}`;

        return (
          <Box key={key} flexDirection="column" marginBottom={theme.dense ? 0 : 1}>
            {index > 0 && !theme.dense && <Text color={theme.border}>{separator(32)}</Text>}
            {item.type === "message"
              ? <MessageItem item={item} theme={theme} />
              : <ToolItem item={item} expanded={expandedToolEventIds.includes(item.id)} theme={theme} />}
          </Box>
        );
      })}
    </Box>
  );
}

function MessageItem({ item, theme }: { item: Extract<TranscriptItem, { type: "message" }>; theme: UiTheme }) {
  return (
    <>
      <Text color={item.message.role === "user" ? theme.user : theme.assistant} bold>
        {sectionLabel(item.message.role === "user" ? "you" : "grok")}
      </Text>
      {item.placeholder
        ? <Text color={theme.muted}>Receiving...</Text>
        : <MarkdownText content={item.message.content} theme={theme} />}
    </>
  );
}

function ToolItem({
  item,
  expanded,
  theme
}: {
  item: Extract<TranscriptItem, { type: "tool" }>;
  expanded: boolean;
  theme: UiTheme;
}) {
  const event = item.event ?? toolEventFromMessage(item);
  const label = statusLabel(event.status, event.result?.ok);
  const color = statusColor(event.status, event.result?.ok);

  return (
    <Box flexDirection="column">
      <Text color={theme.accent} bold>{sectionLabel("tool")}</Text>
      <Text color={color}>
        {event.tool} [{label}] {compactToolSummary(event)}
        {expanded ? " (details)" : ""}
      </Text>
      {expanded && (
        <Box marginLeft={2} flexDirection="column">
          <Text color={theme.muted}>{toolDetails(event)}</Text>
        </Box>
      )}
    </Box>
  );
}

function toolEventFromMessage(item: Extract<TranscriptItem, { type: "tool" }>): ToolRuntimeEvent {
  const result = parseToolResult(item.message?.content);

  return {
    id: item.id,
    tool: result?.tool ?? item.call?.name ?? "tool",
    status: result ? "completed" : "requested",
    ...(item.call ? { args: parseToolArguments(item.call.arguments) } : {}),
    ...(result ? { result } : {})
  };
}

function parseToolResult(content: string | undefined): ToolRuntimeEvent["result"] | undefined {
  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as ToolRuntimeEvent["result"];
  } catch {
    return undefined;
  }
}

function parseToolArguments(raw: string | undefined): unknown {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function toolDetails(event: ToolRuntimeEvent): string {
  if (event.result?.ok) {
    return JSON.stringify(event.result.output ?? {}, null, 2);
  }

  if (event.result && !event.result.ok) {
    return event.result.error
      ? `${event.result.error.code}: ${event.result.error.message}`
      : "tool failed";
  }

  return JSON.stringify(event.args ?? {}, null, 2);
}
