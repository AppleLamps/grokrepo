export type DiffLineColor = "green" | "red" | "cyan" | "gray";

export interface RenderedDiffLine {
  text: string;
  color: DiffLineColor;
}

export function renderDiffLines(diff: string, limit = 80): { lines: RenderedDiffLine[]; remaining: number } {
  const allLines = diff.split(/\r?\n/);
  const visible = allLines.slice(0, limit).map((line) => ({
    text: line,
    color: diffLineColor(line)
  }));

  return {
    lines: visible,
    remaining: Math.max(0, allLines.length - visible.length)
  };
}

export function diffLineColor(line: string): DiffLineColor {
  if (line.startsWith("@@")) {
    return "cyan";
  }

  if (line.startsWith("---") || line.startsWith("+++")) {
    return "gray";
  }

  if (line.startsWith("+")) {
    return "green";
  }

  if (line.startsWith("-")) {
    return "red";
  }

  return "gray";
}
