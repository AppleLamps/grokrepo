import { Box, Text } from "ink";

import { getTheme, type UiTheme } from "./theme.js";

export interface MarkdownLine {
  kind: "blank" | "paragraph" | "heading" | "list" | "code";
  text: string;
  level?: number;
}

interface MarkdownTextProps {
  content: string;
  theme?: UiTheme;
}

export function markdownLines(content: string): MarkdownLine[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const rendered: MarkdownLine[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const fence = /^```/.test(line.trim());
    if (fence) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      rendered.push({ kind: "code", text: line });
      continue;
    }

    if (line.trim().length === 0) {
      rendered.push({ kind: "blank", text: "" });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const marker = heading[1] ?? "#";
      const text = heading[2] ?? "";
      rendered.push({ kind: "heading", level: marker.length, text: stripInlineMarkdown(text) });
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      rendered.push({ kind: "list", text: stripInlineMarkdown((unordered ?? ordered)?.[1] ?? "") });
      continue;
    }

    rendered.push({ kind: "paragraph", text: line });
  }

  return trimBlankEdges(rendered);
}

export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

export function MarkdownText({ content, theme = getTheme("dark") }: MarkdownTextProps) {
  const lines = markdownLines(content);

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <MarkdownLineView key={`markdown_${index}`} line={line} theme={theme} />
      ))}
    </Box>
  );
}

function MarkdownLineView({ line, theme }: { line: MarkdownLine; theme: UiTheme }) {
  if (line.kind === "blank") {
    return <Text> </Text>;
  }

  if (line.kind === "heading") {
    return (
      <Text bold color={theme.assistant}>
        {stripInlineMarkdown(line.text)}
      </Text>
    );
  }

  if (line.kind === "list") {
    return (
      <Text>
        <Text color={theme.muted}>  - </Text>
        <InlineMarkdown text={line.text} theme={theme} />
      </Text>
    );
  }

  if (line.kind === "code") {
    return <Text color={theme.muted}>{line.text}</Text>;
  }

  return (
    <Text>
      <InlineMarkdown text={line.text} theme={theme} />
    </Text>
  );
}

function InlineMarkdown({ text, theme }: { text: string; theme: UiTheme }) {
  const parts = splitInlineMarkdown(text);

  return (
    <>
      {parts.map((part, index) => (
        <Text
          key={`inline_${index}`}
          bold={part.kind === "bold"}
          color={part.kind === "code" || part.kind === "link" ? theme.accent : undefined}
        >
          {part.text}
        </Text>
      ))}
    </>
  );
}

type InlinePart = { kind: "text" | "bold" | "code" | "link"; text: string };

function splitInlineMarkdown(value: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ kind: "text", text: value.slice(cursor, index) });
    }

    if (match[2]) {
      parts.push({ kind: "code", text: match[2] });
    } else if (match[4]) {
      parts.push({ kind: "bold", text: match[4] });
    } else if (match[6]) {
      parts.push({ kind: "link", text: `${match[6]} (${match[7] ?? ""})` });
    }

    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push({ kind: "text", text: value.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ kind: "text", text: value }];
}

function trimBlankEdges(lines: MarkdownLine[]): MarkdownLine[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.kind === "blank") {
    start += 1;
  }

  while (end > start && lines[end - 1]?.kind === "blank") {
    end -= 1;
  }

  return lines.slice(start, end);
}
