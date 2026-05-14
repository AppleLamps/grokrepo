export type PatchFileKind = "modify" | "create" | "delete";

export interface PatchLine {
  type: "context" | "add" | "remove";
  content: string;
}

export interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: PatchLine[];
}

export interface PatchFile {
  oldPath: string | null;
  newPath: string | null;
  path: string;
  kind: PatchFileKind;
  hunks: PatchHunk[];
  raw: string;
}

export interface ParsedPatch {
  files: PatchFile[];
}

export function parseUnifiedDiff(patch: string): ParsedPatch {
  if (patch.includes("GIT binary patch") || patch.includes("Binary files ")) {
    throw new Error("Binary patches are not supported in Phase 3.");
  }

  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: PatchFile[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index]?.startsWith("--- ")) {
      index += 1;
      continue;
    }

    const startIndex = index;
    const oldPath = parseDiffPath(lines[index] ?? "");
    index += 1;

    if (!lines[index]?.startsWith("+++ ")) {
      throw new Error("Invalid unified diff: expected +++ file header.");
    }

    const newPath = parseDiffPath(lines[index] ?? "");
    index += 1;

    if (!oldPath && !newPath) {
      throw new Error("Invalid unified diff: both file paths are /dev/null.");
    }

    if (oldPath && newPath && oldPath !== newPath) {
      throw new Error("Renames are not supported in Phase 3 patches.");
    }

    const hunks: PatchHunk[] = [];

    while (index < lines.length && !lines[index]?.startsWith("--- ")) {
      const line = lines[index] ?? "";

      if (!line.startsWith("@@ ")) {
        index += 1;
        continue;
      }

      const parsedHeader = parseHunkHeader(line);
      index += 1;

      const hunkLines: PatchLine[] = [];

      while (index < lines.length && !lines[index]?.startsWith("@@ ") && !lines[index]?.startsWith("--- ")) {
        const hunkLine = lines[index] ?? "";

        if (hunkLine === "\\ No newline at end of file") {
          index += 1;
          continue;
        }

        const prefix = hunkLine[0];
        const content = hunkLine.slice(1);

        if (prefix === " ") {
          hunkLines.push({ type: "context", content });
        } else if (prefix === "+") {
          hunkLines.push({ type: "add", content });
        } else if (prefix === "-") {
          hunkLines.push({ type: "remove", content });
        } else if (hunkLine.length === 0) {
          break;
        } else {
          throw new Error(`Invalid unified diff hunk line: ${hunkLine}`);
        }

        index += 1;
      }

      hunks.push({
        ...parsedHeader,
        header: line,
        lines: hunkLines
      });
    }

    if (hunks.length === 0) {
      throw new Error("Invalid unified diff: file has no hunks.");
    }

    const path = newPath ?? oldPath;

    if (!path) {
      throw new Error("Invalid unified diff: missing file path.");
    }

    files.push({
      oldPath,
      newPath,
      path,
      kind: !oldPath ? "create" : !newPath ? "delete" : "modify",
      hunks,
      raw: lines.slice(startIndex, index).join("\n")
    });
  }

  if (files.length === 0) {
    throw new Error("Invalid unified diff: no file changes found.");
  }

  return { files };
}

export function generateUnifiedDiff(path: string, oldContent: string, newContent: string): string {
  const oldLines = splitContentLines(oldContent);
  const newLines = splitContentLines(newContent);
  const operations = diffLines(oldLines, newLines);
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const hunkLines = operations.map((operation) => `${operation.prefix}${operation.line}`);

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...hunkLines
  ].join("\n");
}

export function applyPatchToContent(file: PatchFile, content: string): string {
  const sourceLines = splitContentLines(content);
  const outputLines: string[] = [];
  let sourceIndex = 0;

  for (const hunk of file.hunks) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);

    while (sourceIndex < hunkStart) {
      const sourceLine = sourceLines[sourceIndex];

      if (sourceLine === undefined) {
        throw new Error(`Patch hunk starts past end of file: ${file.path}`);
      }

      outputLines.push(sourceLine);
      sourceIndex += 1;
    }

    for (const line of hunk.lines) {
      if (line.type === "add") {
        outputLines.push(line.content);
        continue;
      }

      const sourceLine = sourceLines[sourceIndex];

      if (sourceLine !== line.content) {
        throw new Error(`Stale patch for ${file.path}: expected "${line.content}" at line ${sourceIndex + 1}.`);
      }

      if (line.type === "context") {
        outputLines.push(sourceLine);
      }

      sourceIndex += 1;
    }
  }

  while (sourceIndex < sourceLines.length) {
    const sourceLine = sourceLines[sourceIndex];

    if (sourceLine !== undefined) {
      outputLines.push(sourceLine);
    }

    sourceIndex += 1;
  }

  return `${outputLines.join("\n")}${outputLines.length > 0 ? "\n" : ""}`;
}

function parseDiffPath(line: string): string | null {
  const rawPath = line.slice(4).split(/\t|\s/)[0] ?? "";

  if (rawPath === "/dev/null") {
    return null;
  }

  return rawPath.replace(/^a\//, "").replace(/^b\//, "");
}

function parseHunkHeader(line: string): Omit<PatchHunk, "header" | "lines"> {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

  if (!match) {
    throw new Error(`Invalid unified diff hunk header: ${line}`);
  }

  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? "1")
  };
}

function splitContentLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");

  if (normalized.length === 0) {
    return [];
  }

  const lines = normalized.split("\n");

  if (normalized.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function diffLines(oldLines: string[], newLines: string[]): Array<{ prefix: " " | "+" | "-"; line: string }> {
  const matrix = Array.from({ length: oldLines.length + 1 }, () => Array<number>(newLines.length + 1).fill(0));

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      matrix[oldIndex]![newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? matrix[oldIndex + 1]![newIndex + 1]! + 1
          : Math.max(matrix[oldIndex + 1]![newIndex]!, matrix[oldIndex]![newIndex + 1]!);
    }
  }

  const operations: Array<{ prefix: " " | "+" | "-"; line: string }> = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      operations.push({ prefix: " ", line: oldLines[oldIndex] ?? "" });
      oldIndex += 1;
      newIndex += 1;
    } else if (newIndex < newLines.length && (oldIndex === oldLines.length || matrix[oldIndex]![newIndex + 1]! >= matrix[oldIndex + 1]![newIndex]!)) {
      operations.push({ prefix: "+", line: newLines[newIndex] ?? "" });
      newIndex += 1;
    } else {
      operations.push({ prefix: "-", line: oldLines[oldIndex] ?? "" });
      oldIndex += 1;
    }
  }

  return operations;
}
