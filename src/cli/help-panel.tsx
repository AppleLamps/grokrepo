import { Box, Text } from "ink";

import { getTheme, type UiTheme } from "./theme.js";
import { sectionLabel } from "./ui-format.js";

interface HelpPanelProps {
  visible: boolean;
  theme?: UiTheme;
}

export interface HelpPanelModel {
  title: string;
  lines: string[];
}

export function helpPanelModel(): HelpPanelModel {
  return {
    title: `${sectionLabel("help")} commands`,
    lines: [
      "/help toggles this view",
      "/exit or /quit closes GrokCode",
      "/retry repeats the last prompt",
      "/plan switches to read-only planning mode",
      "/act switches to implementation mode",
      "/mode reports the current task mode",
      "/checkpoint create/list/restore manages task checkpoints",
      "/debug toggles recent debug logs",
      "/clip [prompt] captures a Windows clipboard image",
      "Tab expands or collapses latest search details",
      "Arrows edit input and browse history",
      "Ctrl+A/E/U/K/W moves or clears input"
    ]
  };
}

export function HelpPanel({ visible, theme = getTheme("dark") }: HelpPanelProps) {
  if (!visible) {
    return null;
  }

  const model = helpPanelModel();

  return (
    <Box flexDirection="column">
      <Text color={theme.accent} bold>{model.title}</Text>
      {model.lines.map((line, index) => (
        <Text key={`help_line_${index}`} color={theme.muted}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
