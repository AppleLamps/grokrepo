import { Box, Text } from "ink";
import path from "node:path";

import type { GrokUsage } from "../providers/grok.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import { getTheme, type UiTheme } from "./theme.js";
import { truncateEnd } from "./ui-format.js";

interface StatusBarProps {
  busy: boolean;
  error?: string;
  usage?: GrokUsage;
  contextMetadata?: ContextRuntimeMetadata;
  debug?: boolean;
  providerStatus?: string;
  cwd?: string;
  theme?: UiTheme;
}

export function statusBarParts(props: StatusBarProps): string[] {
  return [...statusBarLeftParts(props), ...statusBarRightParts(props)];
}

export interface StatusBarModel {
  left: string;
  right: string;
}

export function statusBarModel(props: StatusBarProps, width = process.stdout.columns ?? 80): StatusBarModel {
  const maxWidth = Math.max(24, width - 4);
  const leftRaw = statusBarLeftParts(props).join(" | ");
  const rightRaw = statusBarRightParts(props).join(" | ");

  if (!leftRaw) {
    return {
      left: "",
      right: truncateEnd(rightRaw, maxWidth)
    };
  }

  if (!rightRaw) {
    return {
      left: truncateEnd(leftRaw, maxWidth),
      right: ""
    };
  }

  const rightLimit = Math.min(rightRaw.length, Math.max(12, Math.floor(maxWidth * 0.4)));
  const right = truncateEnd(rightRaw, rightLimit);
  const leftWidth = Math.max(8, maxWidth - right.length - 2);

  return {
    left: truncateEnd(leftRaw, leftWidth),
    right
  };
}

function statusBarLeftParts(props: StatusBarProps): string[] {
  const parts = [
    compactProviderStatus(props.providerStatus),
    props.cwd ? path.basename(props.cwd) : undefined
  ].filter((part): part is string => Boolean(part));

  if (props.usage) {
    parts.push(`tokens p:${props.usage.promptTokens ?? "?"} c:${props.usage.completionTokens ?? "?"} t:${props.usage.totalTokens ?? "?"}`);
  }

  if (props.contextMetadata?.repoContext) {
    const repo = props.contextMetadata.repoContext;
    parts.push(`repo ${repo.estimatedTokens}t${repo.truncated ? " truncated" : ""}`);
  }

  if (props.contextMetadata?.conversationSummary.summarized) {
    const summary = props.contextMetadata.conversationSummary;
    parts.push(`summary ${summary.coveredMessageCount} msgs -> ${summary.estimatedTokens ?? "?"}t`);
  }

  if (props.contextMetadata?.conversationSummary.error) {
    parts.push(`summary skipped ${props.contextMetadata.conversationSummary.error.code}`);
  }

  return parts;
}

function statusBarRightParts(props: StatusBarProps): string[] {
  const parts = [props.busy ? "working" : "idle"];

  if (props.debug) {
    parts.push("debug");
  }

  if (props.error) {
    parts.push(`error ${props.error}`);
    parts.push("retry /retry");
  }

  return parts;
}

export function StatusBar(props: StatusBarProps) {
  const model = statusBarModel(props);
  const theme = props.theme ?? getTheme("dark");
  const color = props.error ? theme.error : props.busy ? theme.accent : theme.muted;

  return (
    <Box justifyContent="space-between">
      <Text color={color}>{model.left}</Text>
      <Text color={color}>{model.right}</Text>
    </Box>
  );
}

function compactProviderStatus(status: string | undefined): string | undefined {
  return status
    ?.replace(" via https://api.x.ai/v1 using ", " | x.ai | ")
    .replace(" via https://api.x.ai/v1", " | x.ai");
}
