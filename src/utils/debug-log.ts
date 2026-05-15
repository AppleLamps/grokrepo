import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface DebugLogEntry {
  timestamp: string;
  event: string;
  data?: unknown;
}

export interface DebugLogViewEntry {
  timestamp: string;
  event: string;
  data?: unknown;
  raw?: string;
}

export function debugLogPath(cwd: string): string {
  return path.join(cwd, ".workspace", "logs", "grokcode-debug.log");
}

export function debugLogLine(entry: DebugLogEntry): string {
  return `${JSON.stringify({
    timestamp: entry.timestamp,
    event: entry.event,
    ...(entry.data === undefined ? {} : { data: redactSecrets(entry.data) })
  })}\n`;
}

export async function writeDebugLog(cwd: string, enabled: boolean | undefined, event: string, data?: unknown): Promise<void> {
  if (!enabled) {
    return;
  }

  const logDirectory = path.join(cwd, ".workspace", "logs");
  await mkdir(logDirectory, { recursive: true });
  await appendFile(
    debugLogPath(cwd),
    debugLogLine({ timestamp: new Date().toISOString(), event, data }),
    "utf8"
  );
}

export async function readDebugLogTail(cwd: string, maxLines = 8): Promise<DebugLogViewEntry[]> {
  let raw: string;

  try {
    raw = await readFile(debugLogPath(cwd), "utf8");
  } catch {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines)
    .map((line) => parseDebugLogLine(line));
}

function parseDebugLogLine(line: string): DebugLogViewEntry {
  try {
    const parsed = JSON.parse(line) as Partial<DebugLogViewEntry>;

    return {
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "unknown",
      event: typeof parsed.event === "string" ? parsed.event : "unknown",
      ...(parsed.data !== undefined ? { data: parsed.data } : {})
    };
  } catch {
    return {
      timestamp: "invalid",
      event: "invalid_json",
      raw: line
    };
  }
}

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/(XAI_API_KEY|GROK_API_KEY)=\S+/g, "$1=[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
  }

  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        /apiKey|token|authorization|secret/i.test(key) ? "[redacted]" : redactSecrets(nested)
      ])
    );
  }

  return value;
}
