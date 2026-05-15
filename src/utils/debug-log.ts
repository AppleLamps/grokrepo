import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface DebugLogEntry {
  timestamp: string;
  event: string;
  data?: unknown;
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
    path.join(logDirectory, "grokcode-debug.log"),
    debugLogLine({ timestamp: new Date().toISOString(), event, data }),
    "utf8"
  );
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
