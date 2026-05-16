import { Box, Text } from "ink";

import type { ToolApprovalRequest } from "../runtime/chat.js";
import { renderDiffLines } from "./diff-renderer.js";
import { getTheme, type UiTheme } from "./theme.js";
import { sectionLabel } from "./ui-format.js";

interface ApprovalPanelProps {
  pendingApproval?: ToolApprovalRequest;
  selectedFiles?: readonly string[];
  theme?: UiTheme;
}

export interface ApprovalPanelModel {
  title: string;
  preview: string;
  fileSummary?: string;
  controls: string;
}

export function approvalPanelModel(request: ToolApprovalRequest, selectedFiles: readonly string[] = []): ApprovalPanelModel {
  const files = request.files ?? [];

  return {
    title: `${sectionLabel("approval")} ${request.tool.name}`,
    preview: request.preview,
    ...(request.kind === "patch" && files.length > 0
      ? { fileSummary: `${selectedFiles.length}/${files.length} files selected` }
      : {}),
    controls: request.kind === "patch"
      ? "1-9 toggle files | enter/y apply selected | a all | s skip all | n deny"
      : "y allow | n deny"
  };
}

export function ApprovalPanel({ pendingApproval, selectedFiles = [], theme = getTheme("dark") }: ApprovalPanelProps) {
  if (!pendingApproval) {
    return null;
  }

  const model = approvalPanelModel(pendingApproval, selectedFiles);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.approval} paddingX={1}>
      <Text color={theme.approval} bold>{model.title}</Text>
      {pendingApproval.summary && <Text>{pendingApproval.summary}</Text>}
      <Text>{model.preview}</Text>
      {model.fileSummary && <Text color={theme.muted}>{model.fileSummary}</Text>}
      {pendingApproval.kind === "patch" && pendingApproval.files && pendingApproval.files.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {pendingApproval.files.map((file, index) => (
            <Text key={`${index}_${file}`} color={selectedFiles.includes(file) ? theme.user : theme.muted}>
              {index + 1}. {selectedFiles.includes(file) ? "[x]" : "[ ]"} {file}
            </Text>
          ))}
          {pendingApproval.diff && <RenderedDiff diff={pendingApproval.diff} theme={theme} />}
        </Box>
      )}
      <Text color={theme.muted}>{model.controls}</Text>
    </Box>
  );
}

function RenderedDiff({ diff, theme }: { diff: string; theme: UiTheme }) {
  const rendered = renderDiffLines(diff);

  return (
    <Box flexDirection="column" marginTop={1}>
      {rendered.lines.map((line, index) => (
        <Text key={`diff_line_${index}`} color={line.color}>
          {line.text}
        </Text>
      ))}
      {rendered.remaining > 0 && <Text color={theme.muted}>... {rendered.remaining} more diff line(s)</Text>}
    </Box>
  );
}
