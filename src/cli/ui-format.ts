import type { ToolEventStatus, ToolRuntimeEvent } from "../runtime/chat.js";

export type UiColor = "blue" | "cyan" | "gray" | "green" | "magenta" | "red" | "white" | "yellow";

export function sectionLabel(value: string): string {
  return value.toUpperCase();
}

export function separator(width = 56): string {
  return "-".repeat(width);
}

export function truncateEnd(value: string, maxLength = 96): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function statusLabel(status: ToolEventStatus, ok?: boolean): string {
  if (status === "completed") {
    return ok === false ? "failed" : "done";
  }

  if (status === "approval_requested") {
    return "waiting approval";
  }

  return status.replaceAll("_", " ");
}

export function statusColor(status: ToolEventStatus, ok?: boolean): UiColor {
  if (status === "completed") {
    return ok === false ? "red" : "green";
  }

  if (status === "denied") {
    return "red";
  }

  if (status === "approval_requested") {
    return "yellow";
  }

  if (status === "running") {
    return "cyan";
  }

  return "gray";
}

export function compactToolSummary(event: ToolRuntimeEvent): string {
  const args = isRecord(event.args) ? event.args : {};
  const output = isRecord(event.result?.output) ? event.result?.output : {};

  if (event.result && !event.result.ok) {
    return event.result.error?.message ? truncateEnd(event.result.error.message) : event.result.error?.code ?? "error";
  }

  switch (event.tool) {
    case "read_file":
      return pathSummary(args, output);
    case "write_file":
      return typeof args.path === "string" ? `${args.path} (${byteCount(args.content)} bytes)` : "file write";
    case "file_info":
      return fileInfoSummary(args, output);
    case "create_directory":
      return typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : "directory";
    case "copy_file":
      return copyMoveSummary(args, output);
    case "move_file":
      return copyMoveSummary(args, output);
    case "delete_file":
      return deleteFileSummary(args, output);
    case "list_files":
      return listSummary(args, output);
    case "read_file_range":
      return rangeSummary(args, output);
    case "list_tree":
      return treeSummary(args, output);
    case "list_code_definitions":
      return definitionsSummary(args, output);
    case "find_references":
      return referencesSummary(args, output);
    case "analyze_project_structure":
      return projectStructureSummary(output);
    case "grep":
      return grepSummary(args, output);
    case "git_status":
      return "working tree status";
    case "git_diff":
      return "working tree diff";
    case "git_log":
      return gitLogSummary(output);
    case "git_branch":
      return gitBranchSummary(output);
    case "git_show":
      return typeof args.path === "string" ? `${args.ref ?? "HEAD"}:${args.path}` : typeof args.ref === "string" ? args.ref : "HEAD";
    case "git_diff_file":
      return typeof args.path === "string" ? `${args.path}${args.staged === true ? " staged" : ""}` : "file diff";
    case "git_stage":
      return gitStageSummary(args, output);
    case "git_restore":
      return gitRestoreSummary(args, output);
    case "git_commit":
      return typeof args.message === "string" ? truncateEnd(args.message) : "commit";
    case "run_shell":
      return typeof args.command === "string" ? truncateEnd(args.command) : "shell command";
    case "detect_verification_commands":
      return verificationDetectionSummary(output);
    case "verify_changes":
      return verificationRunSummary(args, output);
    case "checkpoint_create":
      return checkpointCreateSummary(args, output);
    case "checkpoint_list":
      return checkpointListSummary(output);
    case "checkpoint_restore":
      return checkpointRestoreSummary(args, output);
    case "apply_patch":
      return typeof args.summary === "string" ? truncateEnd(args.summary) : "patch";
    case "undo_patch":
      return typeof args.backupId === "string" ? `backup ${args.backupId}` : "latest backup";
    case "web_search":
    case "x_search":
      return searchSummary(args, output);
    case "image_generate":
    case "image_edit":
    case "image_understand":
      return imageSummary(args, output);
    case "capture_clipboard_image":
      return clipboardSummary(output);
    default:
      return event.permission ? `${event.permission} tool` : "tool call";
  }
}

function pathSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const path = typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : "file";
  const size = typeof output.size === "number" ? ` (${output.size} bytes)` : "";
  return `${path}${size}`;
}

function fileInfoSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const path = typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : "path";
  const type = typeof output.type === "string" ? output.type : "unknown";
  const size = typeof output.size === "number" ? ` (${output.size} bytes)` : "";
  return `${path} ${type}${size}`;
}

function copyMoveSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const source = typeof output.source === "string" ? output.source : typeof args.source === "string" ? args.source : "source";
  const destination = typeof output.destination === "string" ? output.destination : typeof args.destination === "string" ? args.destination : "destination";
  return `${source} -> ${destination}`;
}

function deleteFileSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const originalPath = typeof output.originalPath === "string" ? output.originalPath : typeof args.path === "string" ? args.path : "path";
  const trashPath = typeof output.trashPath === "string" ? ` -> ${output.trashPath}` : "";
  return `${originalPath}${trashPath}`;
}

function listSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const path = typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : ".";
  const entries = Array.isArray(output.entries) ? `, ${output.entries.length} entries` : "";
  return `${path}${entries}`;
}

function grepSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const query = typeof args.query === "string" ? args.query : "query";
  const matches = Array.isArray(output.matches) ? `, ${output.matches.length} matches` : "";
  return `${query}${matches}`;
}

function rangeSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const path = typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : "file";
  const startLine = typeof output.startLine === "number" ? output.startLine : typeof args.startLine === "number" ? args.startLine : "?";
  const endLine = typeof output.endLine === "number" ? output.endLine : typeof args.endLine === "number" ? args.endLine : "?";
  return `${path}:${startLine}-${endLine}`;
}

function treeSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const path = typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : ".";
  const entries = Array.isArray(output.entries) ? `, ${output.entries.length} entries` : "";
  return `${path}${entries}`;
}

function definitionsSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const path = typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : ".";
  const definitions = Array.isArray(output.definitions) ? `, ${output.definitions.length} definitions` : "";
  return `${path}${definitions}`;
}

function referencesSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const query = typeof output.query === "string" ? output.query : typeof args.query === "string" ? args.query : "reference";
  const matches = Array.isArray(output.matches) ? `, ${output.matches.length} matches` : "";
  return `${query}${matches}`;
}

function projectStructureSummary(output: Record<string, unknown>): string {
  const frameworks = Array.isArray(output.frameworks) ? output.frameworks.length : 0;
  const modules = Array.isArray(output.modules) ? output.modules.length : 0;
  const tests = Array.isArray(output.tests) ? output.tests.length : 0;
  return `${frameworks} frameworks, ${modules} modules, ${tests} tests`;
}

function gitLogSummary(output: Record<string, unknown>): string {
  const commits = Array.isArray(output.commits) ? output.commits.length : 0;
  return `${commits} commit${commits === 1 ? "" : "s"}`;
}

function gitBranchSummary(output: Record<string, unknown>): string {
  const current = typeof output.current === "string" ? output.current : "unknown";
  const branches = Array.isArray(output.branches) ? `, ${output.branches.length} branches` : "";
  return `${current}${branches}`;
}

function gitStageSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const paths = Array.isArray(output.stagedPaths) ? output.stagedPaths : Array.isArray(args.paths) ? args.paths : [];
  return `${paths.length} staged path${paths.length === 1 ? "" : "s"}`;
}

function gitRestoreSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const paths = Array.isArray(output.paths) ? output.paths : Array.isArray(args.paths) ? args.paths : [];
  const mode = output.staged === true || args.staged === true ? "unstaged" : "restored";
  return `${paths.length} ${mode} path${paths.length === 1 ? "" : "s"}`;
}

function searchSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const query = typeof output.query === "string" ? output.query : typeof args.query === "string" ? args.query : "search";
  const citations = Array.isArray(output.citations) ? `, ${output.citations.length} sources` : "";
  return `${truncateEnd(query, 72)}${citations}`;
}

function imageSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const prompt = typeof output.prompt === "string" ? output.prompt : typeof args.prompt === "string" ? args.prompt : "image";
  const images = Array.isArray(output.images) ? `, ${output.images.length} image${output.images.length === 1 ? "" : "s"}` : "";
  return `${truncateEnd(prompt, 72)}${images}`;
}

function verificationDetectionSummary(output: Record<string, unknown>): string {
  const commands = Array.isArray(output.commands) ? output.commands.length : 0;
  const packageManager = typeof output.packageManager === "string" ? output.packageManager : "package";
  return `${packageManager}, ${commands} command${commands === 1 ? "" : "s"}`;
}

function verificationRunSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const commands = Array.isArray(output.commands) ? output.commands.length : Array.isArray(args.commands) ? args.commands.length : 0;
  const elapsed = typeof output.elapsedMs === "number" ? ` in ${output.elapsedMs}ms` : "";
  return commands > 0 ? `${commands} verification command${commands === 1 ? "" : "s"}${elapsed}` : "verification";
}

function checkpointCreateSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const id = typeof output.id === "string" ? output.id : "checkpoint";
  const name = typeof output.name === "string" ? ` ${output.name}` : typeof args.name === "string" ? ` ${args.name}` : "";
  const files = typeof output.fileCount === "number" ? `, ${output.fileCount} files` : "";
  return `${id}${name}${files}`;
}

function checkpointListSummary(output: Record<string, unknown>): string {
  const checkpoints = Array.isArray(output.checkpoints) ? output.checkpoints.length : 0;
  return `${checkpoints} checkpoint${checkpoints === 1 ? "" : "s"}`;
}

function checkpointRestoreSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const id = typeof output.id === "string" ? output.id : typeof args.id === "string" ? args.id : "latest checkpoint";
  const restored = Array.isArray(output.restoredFiles) ? `, ${output.restoredFiles.length} restored` : "";
  const removed = Array.isArray(output.removedFiles) ? `, ${output.removedFiles.length} removed` : "";
  return `${id}${restored}${removed}`;
}

function clipboardSummary(output: Record<string, unknown>): string {
  const savedPath = typeof output.path === "string" ? output.path : ".workspace/images";
  const size = typeof output.bytes === "number" ? ` (${output.bytes} bytes)` : "";
  return `clipboard -> ${savedPath}${size}`;
}

function byteCount(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
