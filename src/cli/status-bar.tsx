import { Text } from "ink";

import type { GrokUsage } from "../providers/grok.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import { getTheme, type UiTheme } from "./theme.js";
import { sectionLabel } from "./ui-format.js";

interface StatusBarProps {
  busy: boolean;
  error?: string;
  usage?: GrokUsage;
  contextMetadata?: ContextRuntimeMetadata;
  debug?: boolean;
  theme?: UiTheme;
}

export function statusBarParts(props: StatusBarProps): string[] {
  const parts = [props.busy ? "working" : "idle"];

  if (props.debug) {
    parts.push("debug");
  }

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

  if (props.error) {
    parts.push(`error ${props.error}`);
    parts.push("retry /retry");
  }

  return parts;
}

export function StatusBar(props: StatusBarProps) {
  const parts = statusBarParts(props);
  const theme = props.theme ?? getTheme("dark");
  const color = props.error ? theme.error : props.busy ? theme.accent : theme.muted;

  return (
    <Text color={color}>
      {sectionLabel("status")} {parts.join(" | ")}
    </Text>
  );
}
