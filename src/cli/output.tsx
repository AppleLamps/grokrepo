import { Box } from "ink";

import type { GrokUsage } from "../providers/grok.js";
import type { ToolApprovalRequest, ToolRuntimeEvent } from "../runtime/chat.js";
import type { SessionMessage } from "../runtime/session.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import type { DebugLogViewEntry } from "../utils/debug-log.js";
import { ApprovalPanel } from "./approval-panel.js";
import { DebugPanel } from "./debug-panel.js";
import { HelpPanel } from "./help-panel.js";
import { MessageList } from "./message-list.js";
import { getTheme, type UiTheme } from "./theme.js";
import { isExpandableSearchEvent, searchResultDetails } from "./tool-timeline.js";

interface ChatOutputProps {
  messages: readonly SessionMessage[];
  toolEvents: readonly ToolRuntimeEvent[];
  pendingApproval?: ToolApprovalRequest;
  selectedApprovalFiles?: readonly string[];
  expandedToolEventIds?: readonly string[];
  error?: string;
  usage?: GrokUsage;
  contextMetadata?: ContextRuntimeMetadata;
  debugEntries?: readonly DebugLogViewEntry[];
  debugVisible?: boolean;
  helpVisible?: boolean;
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
  debugEntries = [],
  debugVisible = false,
  helpVisible = false,
  busy = false,
  debug = false,
  theme = getTheme("dark")
}: ChatOutputProps) {
  return (
    <Box flexDirection="column" gap={theme.dense ? 0 : 1}>
      <MessageList
        messages={messages}
        toolEvents={toolEvents}
        expandedToolEventIds={expandedToolEventIds}
        busy={busy}
        theme={theme}
      />
      <ApprovalPanel pendingApproval={pendingApproval} selectedFiles={selectedApprovalFiles} theme={theme} />
      <DebugPanel entries={debugEntries} visible={debugVisible} theme={theme} />
      <HelpPanel visible={helpVisible} theme={theme} />
    </Box>
  );
}

export { isExpandableSearchEvent, searchResultDetails };
