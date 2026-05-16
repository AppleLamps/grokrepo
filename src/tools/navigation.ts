import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { getOptionalString, getString, isRecord } from "./args.js";
import { scanRepo } from "../context/scanner.js";
import { resolveWorkspacePath, toWorkspaceRelativePath } from "./path.js";
import { runFileCommand } from "./process.js";
import { toolFailure, toolSuccess, type Tool, type ToolExecutionContext, type ToolExecutionResult } from "./types.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".workspace"]);
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const MAX_IN_MEMORY_RANGE_BYTES = 200_000;
const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  ".css",
  ".json",
  ".md",
  ".txt",
  ".yaml",
  ".yml"
]);

export function createNavigationTools(): Tool[] {
  return [readFileRangeTool, listTreeTool, listCodeDefinitionsTool, findReferencesTool, analyzeProjectStructureTool];
}

const readFileRangeTool: Tool = {
  name: "read_file_range",
  description: "Read a specific 1-based line range from a UTF-8 workspace text file.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path to read." },
      startLine: { type: "number", description: "1-based first line to read. Defaults to 1." },
      endLine: { type: "number", description: "1-based final line to read. Defaults to startLine + 199." }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getString(args, "path");
    const startLine = getOptionalPositiveInteger(args, "startLine") ?? 1;
    const requestedEndLine = getOptionalPositiveInteger(args, "endLine") ?? startLine + 199;
    const endLine = Math.min(requestedEndLine, startLine + 399);

    if (!requestedPath) {
      return toolFailure("read_file_range", "invalid_arguments", "read_file_range requires a string path.");
    }

    if (endLine < startLine) {
      return toolFailure("read_file_range", "invalid_arguments", "endLine must be greater than or equal to startLine.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("read_file_range", "path_outside_workspace", resolved.error);
    }

    try {
      const fileStat = await stat(resolved.path);
      if (!fileStat.isFile()) {
        return toolFailure("read_file_range", "not_file", `${requestedPath} is not a file.`);
      }

      const range = fileStat.size <= MAX_IN_MEMORY_RANGE_BYTES
        ? readLineRangeFromContent(await readFile(resolved.path, "utf8"), startLine, endLine)
        : await readLineRangeFromStream(resolved.path, startLine, endLine);
      const selected = range.selected;
      const lines = selected.map((text, index) => ({
        line: startLine + index,
        text
      }));

      return toolSuccess("read_file_range", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path),
        startLine,
        endLine: startLine + selected.length - 1,
        totalLines: range.totalLines,
        truncated: requestedEndLine > endLine,
        content: selected.join("\n"),
        lines,
        ...(fileStat.size > MAX_IN_MEMORY_RANGE_BYTES
          ? {
              streamed: true
            }
          : {})
      });
    } catch (cause) {
      return toolFailure("read_file_range", "read_failed", errorMessage(cause));
    }
  }
};

const listTreeTool: Tool = {
  name: "list_tree",
  description: "List a depth-limited workspace tree using standard ignore rules.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative directory path. Defaults to the workspace root." },
      maxDepth: { type: "number", description: "Maximum directory depth to include. Defaults to 2." },
      maxEntries: { type: "number", description: "Maximum entries to return. Defaults to 200." }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getOptionalString(args, "path") ?? ".";
    const maxDepth = Math.min(getOptionalPositiveInteger(args, "maxDepth") ?? 2, 8);
    const maxEntries = Math.min(getOptionalPositiveInteger(args, "maxEntries") ?? 200, 1000);
    const resolved = resolveWorkspacePath(context.cwd, requestedPath);

    if (!resolved.ok) {
      return toolFailure("list_tree", "path_outside_workspace", resolved.error);
    }

    try {
      const rootStat = await stat(resolved.path);
      if (!rootStat.isDirectory()) {
        return toolFailure("list_tree", "not_directory", `${requestedPath} is not a directory.`);
      }

      const entries: TreeEntry[] = [];
      const truncated = await collectTreeEntries(context.cwd, resolved.path, 0, maxDepth, maxEntries, entries);

      return toolSuccess("list_tree", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path),
        maxDepth,
        entries,
        truncated
      });
    } catch (cause) {
      return toolFailure("list_tree", "list_failed", errorMessage(cause));
    }
  }
};

const listCodeDefinitionsTool: Tool = {
  name: "list_code_definitions",
  description: "List top-level JavaScript and TypeScript symbols from a file or directory.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file or directory path. Defaults to src when present, otherwise root." },
      maxFiles: { type: "number", description: "Maximum code files to scan. Defaults to 50." },
      maxDefinitions: { type: "number", description: "Maximum definitions to return. Defaults to 200." }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getOptionalString(args, "path") ?? ".";
    const maxFiles = Math.min(getOptionalPositiveInteger(args, "maxFiles") ?? 50, 200);
    const maxDefinitions = Math.min(getOptionalPositiveInteger(args, "maxDefinitions") ?? 200, 1000);
    const resolved = resolveWorkspacePath(context.cwd, requestedPath);

    if (!resolved.ok) {
      return toolFailure("list_code_definitions", "path_outside_workspace", resolved.error);
    }

    try {
      const files = await collectCodeFiles(context.cwd, resolved.path, maxFiles);
      const definitions: CodeDefinition[] = [];

      for (const file of files) {
        if (definitions.length >= maxDefinitions) {
          break;
        }

        const content = await readFile(file, "utf8");
        definitions.push(...extractDefinitions(content, toWorkspaceRelativePath(context.cwd, file)).slice(0, maxDefinitions - definitions.length));
      }

      return toolSuccess("list_code_definitions", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path),
        files: files.map((file) => toWorkspaceRelativePath(context.cwd, file)),
        definitions,
        truncated: files.length >= maxFiles || definitions.length >= maxDefinitions
      });
    } catch (cause) {
      return toolFailure("list_code_definitions", "definition_scan_failed", errorMessage(cause));
    }
  }
};

const findReferencesTool: Tool = {
  name: "find_references",
  description: "Find workspace references to a symbol or exact text with deterministic local search.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Symbol or exact text to find." },
      path: { type: "string", description: "Workspace-relative file or directory to search. Defaults to root." },
      maxResults: { type: "number", description: "Maximum matches to return. Defaults to 200." }
    },
    required: ["query"],
    additionalProperties: false
  },
  async execute(args, context) {
    const query = getString(args, "query");
    const requestedPath = getOptionalString(args, "path") ?? ".";
    const maxResults = Math.min(getOptionalPositiveInteger(args, "maxResults") ?? 200, 1000);

    if (!query) {
      return toolFailure("find_references", "invalid_arguments", "find_references requires a string query.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("find_references", "path_outside_workspace", resolved.error);
    }

    const rgResult = await runRipgrepReferences(query, resolved.path, context, maxResults);
    if (rgResult.ok || rgResult.error?.code !== "rg_unavailable") {
      return rgResult;
    }

    return runNodeReferences(query, resolved.path, context, maxResults);
  }
};

const analyzeProjectStructureTool: Tool = {
  name: "analyze_project_structure",
  description: "Summarize local project modules, entrypoints, tests, dependencies, and git context.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    try {
      const scan = await scanRepo(context.cwd);
      const packageJson = await readPackageJson(context.cwd);
      const treeFiles = await collectTextFiles(context.cwd, context.cwd, 500);
      const relativeFiles = treeFiles.map((file) => toWorkspaceRelativePath(context.cwd, file));
      const modules = summarizeModules(relativeFiles);
      const tests = relativeFiles.filter(isTestPath).slice(0, 100);

      return toolSuccess("analyze_project_structure", {
        packageManager: scan.packageManager ?? null,
        frameworks: scan.frameworks,
        entrypoints: scan.entrypoints,
        keyFiles: scan.keyFiles,
        modules,
        tests,
        scripts: packageJson?.scripts ?? {},
        dependencies: Object.keys(packageJson?.dependencies ?? {}).sort(),
        devDependencies: Object.keys(packageJson?.devDependencies ?? {}).sort(),
        git: scan.git
      });
    } catch (cause) {
      return toolFailure("analyze_project_structure", "analysis_failed", errorMessage(cause));
    }
  }
};

interface TreeEntry {
  path: string;
  name: string;
  type: "directory" | "file";
  depth: number;
  size?: number;
}

interface CodeDefinition {
  path: string;
  line: number;
  kind: string;
  name: string;
  exported: boolean;
  signature: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readLineRangeFromContent(
  content: string,
  startLine: number,
  endLine: number
): { selected: string[]; totalLines: number } {
  const allLines = content.split(/\r?\n/);

  return {
    selected: allLines.slice(startLine - 1, endLine),
    totalLines: allLines.length
  };
}

async function readLineRangeFromStream(
  filePath: string,
  startLine: number,
  endLine: number
): Promise<{ selected: string[]; totalLines: number }> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity
  });
  const selected: string[] = [];
  let totalLines = 0;

  try {
    for await (const line of reader) {
      totalLines += 1;

      if (totalLines >= startLine && totalLines <= endLine) {
        selected.push(line);
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return {
    selected,
    totalLines
  };
}

async function collectTreeEntries(
  cwd: string,
  directory: string,
  depth: number,
  maxDepth: number,
  maxEntries: number,
  entries: TreeEntry[]
): Promise<boolean> {
  if (entries.length >= maxEntries || depth >= maxDepth) {
    return entries.length >= maxEntries;
  }

  const children = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
    .sort(sortDirents);

  let truncated = false;
  for (const child of children) {
    if (entries.length >= maxEntries) {
      truncated = true;
      break;
    }

    const absolutePath = path.join(directory, child.name);
    const childStat = await stat(absolutePath);
    const type = child.isDirectory() ? "directory" : "file";
    entries.push({
      path: toWorkspaceRelativePath(cwd, absolutePath),
      name: child.name,
      type,
      depth: depth + 1,
      ...(type === "file" ? { size: childStat.size } : {})
    });

    if (child.isDirectory()) {
      truncated = await collectTreeEntries(cwd, absolutePath, depth + 1, maxDepth, maxEntries, entries) || truncated;
    }
  }

  return truncated;
}

async function collectCodeFiles(cwd: string, targetPath: string, maxFiles: number): Promise<string[]> {
  const targetStat = await stat(targetPath);

  if (targetStat.isFile()) {
    return CODE_EXTENSIONS.has(path.extname(targetPath).toLowerCase()) ? [targetPath] : [];
  }

  if (!targetStat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const pending = [targetPath];

  while (pending.length > 0 && files.length < maxFiles) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }

    const children = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
      .sort(sortDirents)
      .reverse();

    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      if (child.isFile() && CODE_EXTENSIONS.has(path.extname(child.name).toLowerCase())) {
        files.push(absolutePath);
        if (files.length >= maxFiles) {
          break;
        }
      }
    }
  }

  return files.sort((left, right) => toWorkspaceRelativePath(cwd, left).localeCompare(toWorkspaceRelativePath(cwd, right)));
}

function extractDefinitions(content: string, relativePath: string): CodeDefinition[] {
  const definitions: CodeDefinition[] = [];
  const lines = content.split(/\r?\n/);
  let braceDepth = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const beforeLineDepth = braceDepth;

    if (beforeLineDepth === 0) {
      const definition = parseDefinitionLine(trimmed, relativePath, index + 1);
      if (definition) {
        definitions.push(definition);
      }
    }

    braceDepth = Math.max(0, braceDepth + countBracesOutsideStrings(line));
  });

  return definitions;
}

function parseDefinitionLine(line: string, relativePath: string, lineNumber: number): CodeDefinition | undefined {
  const patterns: Array<{ kind: string; pattern: RegExp }> = [
    { kind: "function", pattern: /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "class", pattern: /^(export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "interface", pattern: /^(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "type", pattern: /^(export\s+)?type\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "enum", pattern: /^(export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "const", pattern: /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
    { kind: "export", pattern: /^export\s+\{\s*([A-Za-z_$][\w$]*)\b/ }
  ];

  for (const { kind, pattern } of patterns) {
    const match = pattern.exec(line);
    if (match) {
      return {
        path: relativePath,
        line: lineNumber,
        kind,
        name: match[2] ?? match[1] ?? "unknown",
        exported: line.startsWith("export"),
        signature: line
      };
    }
  }

  return undefined;
}

async function runRipgrepReferences(
  query: string,
  absolutePath: string,
  context: ToolExecutionContext,
  maxResults: number
): Promise<ToolExecutionResult> {
  const result = await runFileCommand(
    "rg",
    [
      "--fixed-strings",
      "--line-number",
      "--column",
      "--no-heading",
      "--color",
      "never",
      "--glob",
      "!{.git,node_modules,dist,.workspace}/**",
      query,
      absolutePath
    ],
    { cwd: context.cwd }
  );

  if (result.exitCode === 0 || result.exitCode === 1) {
    const rawMatches = result.stdout.split(/\r?\n/).filter(Boolean);
    const matches = rawMatches.slice(0, maxResults).map((line) => parseRipgrepLine(line, context.cwd));

    return toolSuccess("find_references", {
      query,
      matches,
      truncated: rawMatches.length > matches.length
    });
  }

  const normalizedError = result.stderr.toLowerCase();
  if (normalizedError.includes("not recognized") || normalizedError.includes("not found") || normalizedError.includes("enoent")) {
    return toolFailure("find_references", "rg_unavailable", "ripgrep is unavailable.");
  }

  return toolFailure("find_references", "reference_search_failed", result.stderr || "ripgrep failed.", { exitCode: result.exitCode });
}

async function runNodeReferences(query: string, absolutePath: string, context: ToolExecutionContext, maxResults: number): Promise<ToolExecutionResult> {
  const matches: Array<{ path: string; line: number; column: number; text: string }> = [];
  const files = await collectTextFiles(context.cwd, absolutePath, maxResults * 5);

  for (const file of files) {
    if (matches.length >= maxResults) {
      break;
    }

    const content = await readFile(file, "utf8");
    content.split(/\r?\n/).forEach((line, index) => {
      const column = line.indexOf(query);
      if (column >= 0 && matches.length < maxResults) {
        matches.push({
          path: toWorkspaceRelativePath(context.cwd, file),
          line: index + 1,
          column: column + 1,
          text: line
        });
      }
    });
  }

  return toolSuccess("find_references", {
    query,
    matches,
    truncated: matches.length >= maxResults
  });
}

async function collectTextFiles(cwd: string, targetPath: string, maxFiles: number): Promise<string[]> {
  const targetStat = await stat(targetPath);
  if (targetStat.isFile()) {
    return TEXT_EXTENSIONS.has(path.extname(targetPath).toLowerCase()) ? [targetPath] : [];
  }

  if (!targetStat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const pending = [targetPath];
  while (pending.length > 0 && files.length < maxFiles) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }

    const children = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
      .sort(sortDirents)
      .reverse();

    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        pending.push(absolutePath);
      } else if (child.isFile() && TEXT_EXTENSIONS.has(path.extname(child.name).toLowerCase())) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort((left, right) => toWorkspaceRelativePath(cwd, left).localeCompare(toWorkspaceRelativePath(cwd, right)));
}

function parseRipgrepLine(line: string, cwd: string): { path: string; line: number; column: number; text: string } {
  const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
  if (!match) {
    return {
      path: ".",
      line: 0,
      column: 0,
      text: line
    };
  }

  return {
    path: toWorkspaceRelativePath(cwd, match[1] ?? cwd),
    line: Number(match[2] ?? 0),
    column: Number(match[3] ?? 0),
    text: match[4] ?? ""
  };
}

async function readPackageJson(cwd: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function summarizeModules(files: string[]): Array<{ name: string; path: string; fileCount: number }> {
  const modules = new Map<string, { name: string; path: string; fileCount: number }>();

  for (const file of files) {
    const parts = file.split("/");
    const modulePath = parts[0] === "src" && parts.length > 2 ? `src/${parts[1]}` : parts[0] ?? ".";
    const current = modules.get(modulePath) ?? {
      name: modulePath.split("/").at(-1) ?? modulePath,
      path: modulePath,
      fileCount: 0
    };
    current.fileCount += 1;
    modules.set(modulePath, current);
  }

  return [...modules.values()].sort((left, right) => left.path.localeCompare(right.path)).slice(0, 100);
}

function isTestPath(file: string): boolean {
  return /(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function getOptionalPositiveInteger(args: unknown, key: string): number | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function countBracesOutsideStrings(line: string): number {
  const stripped = line
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/\/\/.*$/, "");
  return [...stripped].reduce((total, char) => total + (char === "{" ? 1 : char === "}" ? -1 : 0), 0);
}

function sortDirents(left: { name: string; isDirectory(): boolean }, right: { name: string; isDirectory(): boolean }): number {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
