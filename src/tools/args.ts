export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(args: unknown, key: string): string | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

export function getOptionalString(args: unknown, key: string): string | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return value === undefined || typeof value === "string" ? value : undefined;
}

export function parseToolArguments(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      value: raw.trim().length === 0 ? {} : JSON.parse(raw)
    };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Invalid JSON arguments."
    };
  }
}
