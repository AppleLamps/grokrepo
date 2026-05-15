import { Box } from "ink";

import type { GrokUsage } from "../providers/grok.js";
import type { ToolApprovalRequest, ToolRuntimeEvent } from "../runtime/chat.js";
import type { SessionMessage } from "../runtime/session.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import { ApprovalPanel } from "./approval-panel.js";
import { MessageList } from "./message-list.js";
import { StatusBar } from "./status-bar.js";
import { getTheme, type UiTheme } from "./theme.js";
import { isExpandableSearchEvent, searchResultDetails, ToolTimeline } from "./tool-timeline.js";

interface ChatOutputProps {
  messages: readonly SessionMessage[];
  toolEvents: readonly ToolRuntimeEvent[];
  pendingApproval?: ToolApprovalRequest;
  selectedApprovalFiles?: readonly string[];
  expandedToolEventIds?: readonly string[];
  error?: string;
  usage?: GrokUsage;
  contextMetadata?: ContextRuntimeMetadata;
  busy?: boolean;
  debug?: boolean;
  theme?: UiTheme;
}

export function ChatOutput({
  messages,
  toolEvents,
  pendingApproval,
  selectedApprovalFiles = [],
  expandedToolEventIds = [],
  error,
  usage,
  contextMetadata,
  busy = false,
  debug = false,
  theme = getTheme("dark")
}: ChatOutputProps) {
  return (
    <Box flexDirection="column" gap={theme.dense ? 0 : 1}>
      <MessageList messages={messages} theme={theme} />
      <ToolTimeline events={toolEvents} expandedToolEventIds={expandedToolEventIds} theme={theme} />
      <ApprovalPanel pendingApproval={pendingApproval} selectedFiles={selectedApprovalFiles} theme={theme} />
      <StatusBar busy={busy} error={error} usage={usage} contextMetadata={contextMetadata} debug={debug} theme={theme} />
    </Box>
  );
}

export { isExpandableSearchEvent, searchResultDetails };
