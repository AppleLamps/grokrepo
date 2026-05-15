import { Box, Text } from "ink";

import type { SessionMessage } from "../runtime/session.js";
import { getTheme, type UiTheme } from "./theme.js";
import { sectionLabel, separator } from "./ui-format.js";

interface MessageListProps {
  messages: readonly SessionMessage[];
  theme?: UiTheme;
}

export function MessageList({ messages, theme = getTheme("dark") }: MessageListProps) {
  const visibleMessages = messages.filter(
    (message) => message.role !== "system" && message.role !== "tool" && message.content.length > 0
  );

  if (visibleMessages.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {visibleMessages.map((message, index) => (
        <Box key={message.id} flexDirection="column" marginBottom={theme.dense ? 0 : 1}>
          {index > 0 && !theme.dense && <Text color={theme.border}>{separator(32)}</Text>}
          <Text color={message.role === "user" ? theme.user : theme.assistant} bold>
            {sectionLabel(message.role === "user" ? "you" : "grok")}
          </Text>
          <Text>{message.content}</Text>
        </Box>
      ))}
    </Box>
  );
}
