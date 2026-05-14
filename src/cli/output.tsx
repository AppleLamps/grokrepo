import { Box, Text } from "ink";

import type { GrokUsage } from "../providers/grok.js";
import type { ToolApprovalRequest, ToolRuntimeEvent } from "../runtime/chat.js";
import type { SessionMessage } from "../runtime/session.js";

interface ChatOutputProps {
  messages: readonly SessionMessage[];
  toolEvents: readonly ToolRuntimeEvent[];
  pendingApproval?: ToolApprovalRequest;
  selectedApprovalFiles?: readonly string[];
  error?: string;
  usage?: GrokUsage;
}

export function ChatOutput({
  messages,
  toolEvents,
  pendingApproval,
  selectedApprovalFiles = [],
  error,
  usage
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
          {toolEvents.map((event, index) => (
            <Text key={`${event.id}_${event.status}_${index}`} color={toolColor(event)}>
              tool {event.tool}: {toolStatusText(event)}
            </Text>
          ))}
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
              {pendingApproval.diff && <Text color="gray">{trimDiff(pendingApproval.diff)}</Text>}
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

      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

function trimDiff(diff: string): string {
  const lines = diff.split(/\r?\n/);
  const visible = lines.slice(0, 80);
  const suffix = lines.length > visible.length ? `\n... ${lines.length - visible.length} more diff line(s)` : "";

  return `${visible.join("\n")}${suffix}`;
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
    return event.result?.ok ? "completed" : `failed (${event.result?.error?.code ?? "unknown_error"})`;
  }

  if (event.status === "denied") {
    return "denied";
  }

  return event.status.replaceAll("_", " ");
}
