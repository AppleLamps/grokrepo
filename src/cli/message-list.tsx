import { Box, Text } from "ink";

import type { SessionMessage } from "../runtime/session.js";
import { getTheme, type UiTheme } from "./theme.js";
import { sectionLabel, separator } from "./ui-format.js";

interface MessageListProps {
  messages: readonly SessionMessage[];
  busy?: boolean;
  theme?: UiTheme;
}

export interface MessageListItem {
  message: SessionMessage;
  placeholder: boolean;
}

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

export function MessageList({ messages, busy = false, theme = getTheme("dark") }: MessageListProps) {
  const visibleMessages = messageListItems(messages, busy);

  if (visibleMessages.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {visibleMessages.map((item, index) => (
        <Box key={item.message.id} flexDirection="column" marginBottom={theme.dense ? 0 : 1}>
          {index > 0 && !theme.dense && <Text color={theme.border}>{separator(32)}</Text>}
          <Text color={item.message.role === "user" ? theme.user : theme.assistant} bold>
            {sectionLabel(item.message.role === "user" ? "you" : "grok")}
          </Text>
          <Text color={item.placeholder ? theme.muted : undefined}>{item.placeholder ? "Receiving..." : item.message.content}</Text>
        </Box>
      ))}
    </Box>
  );
}
