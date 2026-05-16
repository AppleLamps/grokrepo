import { Box, Text } from "ink";

import { getTheme, type UiTheme } from "./theme.js";
import { separator, truncateEnd } from "./ui-format.js";

interface HeaderProps {
  status: string;
  busy: boolean;
  cwd?: string;
  theme?: UiTheme;
  debug?: boolean;
}

export interface HeaderModel {
  mark: string;
  title: string;
  providerLine: string;
  cwdLine: string;
  separator: string;
}

export function headerModel(
  status: string,
  busy: boolean,
  width = process.stdout.columns ?? 80,
  mode = "dark",
  debug = false,
  cwd = process.cwd()
): HeaderModel {
  const lineWidth = Math.max(24, width - 2);
  const compactStatus = compactProviderStatus(status);
  const state = busy ? "working" : "ready";
  const suffix = [mode, state, debug ? "debug" : undefined].filter(Boolean).join(" | ");
  const providerLine = truncateEnd(`${compactStatus} | ${suffix}`, lineWidth);

  return {
    mark: "GC>",
    title: "GrokCode",
    providerLine,
    cwdLine: truncateEnd(cwd, lineWidth),
    separator: separator(lineWidth)
  };
}

export function Header({ status, busy, cwd = process.cwd(), theme = getTheme("dark"), debug = false }: HeaderProps) {
  const model = headerModel(status, busy, process.stdout.columns ?? 80, theme.mode, debug, cwd);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent} bold>{model.mark}</Text>
        <Text> </Text>
        <Text bold>{model.title}</Text>
      </Box>
      <Text color={theme.muted}>{model.providerLine}</Text>
      <Text color={theme.muted}>{model.cwdLine}</Text>
      <Text color={theme.border}>{model.separator}</Text>
    </Box>
  );
}

function compactProviderStatus(status: string): string {
  return status
    .replace(" via https://api.x.ai/v1 using ", " | x.ai | ")
    .replace(" via https://api.x.ai/v1", " | x.ai");
}
