import { Box, Text } from "ink";

import type { DebugLogViewEntry } from "../utils/debug-log.js";
import { getTheme, type UiTheme } from "./theme.js";
import { sectionLabel, truncateEnd } from "./ui-format.js";

interface DebugPanelProps {
  entries: readonly DebugLogViewEntry[];
  visible: boolean;
  theme?: UiTheme;
}

export interface DebugPanelModel {
  title: string;
  empty: string;
  controls: string;
  lines: string[];
}

export function debugPanelModel(entries: readonly DebugLogViewEntry[], maxWidth = 96): DebugPanelModel {
  return {
    title: `${sectionLabel("debug")} recent log entries`,
    empty: "No debug log entries yet.",
    controls: "/debug toggles this view",
    lines: entries.map((entry) => {
      const time = entry.timestamp === "invalid" ? "invalid" : entry.timestamp.slice(11, 19);
      const data = entry.raw ?? (entry.data === undefined ? "" : ` ${JSON.stringify(entry.data)}`);
      return truncateEnd(`${time} ${entry.event}${data}`, maxWidth);
    })
  };
}

export function DebugPanel({ entries, visible, theme = getTheme("dark") }: DebugPanelProps) {
  if (!visible) {
    return null;
  }

  const model = debugPanelModel(entries, process.stdout.columns ? Math.max(40, process.stdout.columns - 4) : 96);

  return (
    <Box flexDirection="column">
      <Text color={theme.accent} bold>
        {model.title}
      </Text>
      {model.lines.length === 0 ? (
        <Text color={theme.muted}>{model.empty}</Text>
      ) : (
        model.lines.map((line, index) => (
          <Text key={`debug_line_${index}`} color={theme.muted}>
            {line}
          </Text>
        ))
      )}
      <Text color={theme.muted}>{model.controls}</Text>
    </Box>
  );
}
