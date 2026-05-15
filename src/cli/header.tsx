import { Box, Text } from "ink";

import { getTheme, type UiTheme } from "./theme.js";
import { sectionLabel, separator, truncateEnd } from "./ui-format.js";

interface HeaderProps {
  status: string;
  busy: boolean;
  theme?: UiTheme;
  debug?: boolean;
}

export interface HeaderModel {
  title: string;
  statusLine: string;
  separator: string;
}

export function headerModel(status: string, busy: boolean, width = process.stdout.columns ?? 80, mode = "dark", debug = false): HeaderModel {
  const lineWidth = Math.max(24, width - 2);
  const compactStatus = compactProviderStatus(status);
  const state = busy ? "working" : "ready";
  const debugText = debug ? " | debug" : "";
  const prefix = `${sectionLabel("status")} Phase 7 UI polish | ${mode} | ${state}${debugText} | `;
  const availableStatusWidth = Math.max(8, lineWidth - prefix.length);
  const statusLine = `${prefix}${truncateEnd(compactStatus, availableStatusWidth)}`;

  return {
    title: "GrokCode",
    statusLine: truncateEnd(statusLine, lineWidth),
    separator: separator(Math.max(24, Math.min(72, lineWidth)))
  };
}

export function Header({ status, busy, theme = getTheme("dark"), debug = false }: HeaderProps) {
  const model = headerModel(status, busy, process.stdout.columns ?? 80, theme.mode, debug);

  return (
    <Box flexDirection="column">
      <Text color={theme.accent} bold>
        {model.title}
      </Text>
      <Text color={theme.muted}>{model.statusLine}</Text>
      <Text color={theme.border}>{model.separator}</Text>
    </Box>
  );
}

function compactProviderStatus(status: string): string {
  return status
    .replace(" via https://api.x.ai/v1 using ", " | x.ai | ")
    .replace(" via https://api.x.ai/v1", " | x.ai");
}
