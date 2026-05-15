import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath, toWorkspaceRelativePath } from "../tools/path.js";
import { scanRepo } from "./scanner.js";
import { estimateTokens } from "./tokens.js";
import type { BuiltContext, ContextBuilder, ContextItem, ContextOptions, RepoScanResult } from "./types.js";

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = {
  tokenBudget: 8_000,
  maxFileBytes: 12_000,
  maxFiles: 12,
  ignoredDirectories: [".git", "node_modules", "dist", ".workspace"]
};

const EXPLICIT_FILE_PATTERN = /(?:`([^`]+\.[a-zA-Z0-9]+)`|"([^"]+\.[a-zA-Z0-9]+)"|'([^']+\.[a-zA-Z0-9]+)'|([\w./\\-]+\.[a-zA-Z0-9]+))/g;
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

export class DefaultContextBuilder implements ContextBuilder {
  private readonly options: ContextOptions;

  constructor(options: Partial<ContextOptions> = {}) {
    this.options = {
      ...DEFAULT_CONTEXT_OPTIONS,
      ...options,
      ignoredDirectories: options.ignoredDirectories ?? DEFAULT_CONTEXT_OPTIONS.ignoredDirectories
    };
  }

  async buildContext(cwd: string, latestUserMessage: string): Promise<BuiltContext> {
    const scan = await scanRepo(cwd);
    const explicitFiles = await resolveExplicitFiles(cwd, latestUserMessage, this.options);
    const inferredFiles = await selectInferredFiles(cwd, scan, explicitFiles, this.options);
    const items = await buildItems(cwd, scan, explicitFiles, inferredFiles, this.options);

    return budgetContext(items, this.options.tokenBudget);
  }
}

export function extractFileReferences(message: string): string[] {
  const references: string[] = [];

  for (const match of message.matchAll(EXPLICIT_FILE_PATTERN)) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4];

    if (value) {
      references.push(normalizeReference(value));
    }
  }

  return [...new Set(references)];
}

export function budgetContext(items: ContextItem[], tokenBudget: number): BuiltContext {
  const sorted = [...items].sort((left, right) => right.priority - left.priority || left.title.localeCompare(right.title));
  const selected: ContextItem[] = [];
  let estimatedTokens = estimateTokens(contextHeader(false));
  let truncated = false;

  for (const item of sorted) {
    const nextTotal = estimatedTokens + item.estimatedTokens;

    if (nextTotal <= tokenBudget) {
      selected.push(item);
      estimatedTokens = nextTotal;
      continue;
    }

    truncated = true;
    if (item.priority >= 100) {
      const availableTokens = Math.max(0, tokenBudget - estimatedTokens - estimateTokens(contextItemHeader(item)));
      const trimmed = trimItemToBudget(item, availableTokens);

      if (trimmed.content.length > 0) {
        selected.push(trimmed);
        estimatedTokens += trimmed.estimatedTokens;
      }
    }
  }

  return {
    prompt: renderContextPrompt(selected, truncated),
    items: selected,
    estimatedTokens,
    truncated
  };
}

async function resolveExplicitFiles(cwd: string, message: string, options: ContextOptions): Promise<string[]> {
  const files: string[] = [];

  for (const reference of extractFileReferences(message)) {
    if (isIgnoredPath(reference, options)) {
      continue;
    }

    const resolved = resolveWorkspacePath(cwd, reference);

    if (!resolved.ok || !await isReadableTextFile(resolved.path, options)) {
      continue;
    }

    files.push(toContextPath(toWorkspaceRelativePath(cwd, resolved.path)));
  }

  return [...new Set(files)];
}

async function selectInferredFiles(
  cwd: string,
  scan: RepoScanResult,
  explicitFiles: string[],
  options: ContextOptions
): Promise<string[]> {
  const candidates = [
    ...scan.keyFiles,
    ...scan.entrypoints,
    ...scan.git.status.map((line) => line.slice(3).trim()).filter(Boolean),
    ...scan.git.recentFiles
  ];
  const files: string[] = [];

  for (const candidate of candidates) {
    if (files.length >= options.maxFiles) {
      break;
    }

    if (explicitFiles.includes(candidate) || isIgnoredPath(candidate, options)) {
      continue;
    }

    const resolved = resolveWorkspacePath(cwd, candidate);

    if (!resolved.ok || !await isReadableTextFile(resolved.path, options)) {
      continue;
    }

    files.push(toContextPath(toWorkspaceRelativePath(cwd, resolved.path)));
  }

  if (files.length < options.maxFiles) {
    for (const sourceFile of await listShallowSourceFiles(cwd, options)) {
      if (files.length >= options.maxFiles) {
        break;
      }

      if (!explicitFiles.includes(sourceFile) && !files.includes(sourceFile)) {
        files.push(sourceFile);
      }
    }
  }

  return [...new Set(files)];
}

async function buildItems(
  cwd: string,
  scan: RepoScanResult,
  explicitFiles: string[],
  inferredFiles: string[],
  options: ContextOptions
): Promise<ContextItem[]> {
  const items: ContextItem[] = [
    createItem("metadata", "Repository Summary", renderRepoSummary(scan), 90),
    createItem("git", "Git State", renderGitState(scan), 80)
  ];

  for (const file of explicitFiles) {
    const content = await readFileExcerpt(cwd, file, options);
    items.push(createItem("file", `Explicit File: ${file}`, content, 110, file));
  }

  for (const file of inferredFiles) {
    const content = await readFileExcerpt(cwd, file, options);
    const priority = scan.keyFiles.includes(file) ? 70 : scan.entrypoints.includes(file) ? 65 : 50;
    items.push(createItem("file", `Context File: ${file}`, content, priority, file));
  }

  return items;
}

function renderRepoSummary(scan: RepoScanResult): string {
  return [
    `cwd: ${scan.cwd}`,
    `packageManager: ${scan.packageManager ?? "unknown"}`,
    `frameworks: ${scan.frameworks.length > 0 ? scan.frameworks.join(", ") : "none detected"}`,
    `entrypoints: ${scan.entrypoints.length > 0 ? scan.entrypoints.join(", ") : "none detected"}`,
    `keyFiles: ${scan.keyFiles.length > 0 ? scan.keyFiles.join(", ") : "none detected"}`
  ].join("\n");
}

function renderGitState(scan: RepoScanResult): string {
  if (!scan.git.isRepo) {
    return "isRepo: false";
  }

  return [
    "isRepo: true",
    `branch: ${scan.git.branch ?? "unknown"}`,
    `status:\n${scan.git.status.length > 0 ? scan.git.status.slice(0, 40).join("\n") : "clean"}`,
    `recentFiles:\n${scan.git.recentFiles.length > 0 ? scan.git.recentFiles.slice(0, 40).join("\n") : "none"}`
  ].join("\n");
}

async function readFileExcerpt(cwd: string, relativePath: string, options: ContextOptions): Promise<string> {
  const resolved = resolveWorkspacePath(cwd, relativePath);

  if (!resolved.ok) {
    return resolved.error;
  }

  const content = await readFile(resolved.path, "utf8");
  const excerpt = content.length > options.maxFileBytes ? `${content.slice(0, options.maxFileBytes)}\n[truncated]` : content;

  return `path: ${relativePath}\n${excerpt}`;
}

async function listShallowSourceFiles(cwd: string, options: ContextOptions): Promise<string[]> {
  const srcPath = path.join(cwd, "src");
  const files: string[] = [];

  try {
    const entries = await readdir(srcPath, { recursive: true, withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const parentPath = "parentPath" in entry && typeof entry.parentPath === "string" ? entry.parentPath : srcPath;
      const absolutePath = path.join(parentPath, entry.name);
      const relativePath = toContextPath(toWorkspaceRelativePath(cwd, absolutePath));

      if (!isIgnoredPath(relativePath, options) && await isReadableTextFile(absolutePath, options)) {
        files.push(relativePath);
      }
    }
  } catch {
    return [];
  }

  return files.sort().slice(0, options.maxFiles);
}

async function isReadableTextFile(absolutePath: string, options: ContextOptions): Promise<boolean> {
  try {
    const fileStat = await stat(absolutePath);
    return fileStat.isFile() && fileStat.size <= 1_000_000 && TEXT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase());
  } catch {
    return false;
  }
}

function createItem(kind: ContextItem["kind"], title: string, content: string, priority: number, itemPath?: string): ContextItem {
  return {
    kind,
    title,
    content,
    priority,
    estimatedTokens: estimateTokens(`${contextItemHeader({ title, path: itemPath })}\n${content}`),
    ...(itemPath ? { path: itemPath } : {})
  };
}

function trimItemToBudget(item: ContextItem, availableTokens: number): ContextItem {
  const maxChars = Math.max(0, availableTokens * 4);
  const content = item.content.slice(0, maxChars);

  return {
    ...item,
    content,
    estimatedTokens: estimateTokens(`${contextItemHeader(item)}\n${content}`)
  };
}

function renderContextPrompt(items: ContextItem[], truncated: boolean): string {
  return [
    contextHeader(truncated),
    ...items.map((item) => `${contextItemHeader(item)}\n${item.content}`)
  ].join("\n\n");
}

function contextHeader(truncated: boolean): string {
  return [
    "<repo_context>",
    "Purpose: lightweight repository navigation context.",
    "Rules: treat this as a hint, use tools before exact claims or edits.",
    `truncated: ${truncated}`
  ].join("\n");
}

function contextItemHeader(item: Pick<ContextItem, "title" | "path">): string {
  return `## ${item.title}${item.path ? ` (${item.path})` : ""}`;
}

function normalizeReference(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^[.][/]/, "");
}

function toContextPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isIgnoredPath(relativePath: string, options: ContextOptions): boolean {
  const normalized = normalizeReference(relativePath);
  return normalized.split("/").some((part) => options.ignoredDirectories.includes(part));
}
