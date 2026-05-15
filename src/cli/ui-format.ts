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
    case "list_files":
      return listSummary(args, output);
    case "grep":
      return grepSummary(args, output);
    case "git_status":
      return "working tree status";
    case "git_diff":
      return "working tree diff";
    case "git_commit":
      return typeof args.message === "string" ? truncateEnd(args.message) : "commit";
    case "run_shell":
      return typeof args.command === "string" ? truncateEnd(args.command) : "shell command";
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
    default:
      return event.permission ? `${event.permission} tool` : "tool call";
  }
}

function pathSummary(args: Record<string, unknown>, output: Record<string, unknown>): string {
  const path = typeof output.path === "string" ? output.path : typeof args.path === "string" ? args.path : "file";
  const size = typeof output.size === "number" ? ` (${output.size} bytes)` : "";
  return `${path}${size}`;
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

function byteCount(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
