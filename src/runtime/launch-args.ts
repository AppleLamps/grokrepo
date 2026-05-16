import { parseHeadlessArgs, type HeadlessOptions } from "./headless.js";

export interface WebOptions {
  host: string;
  port: number;
}

export type ParsedLaunchArgs =
  | { mode: "interactive" }
  | { mode: "headless"; options: HeadlessOptions }
  | { mode: "web"; options: WebOptions }
  | { mode: "error"; error: string };

const DEFAULT_WEB_HOST = "127.0.0.1";
const DEFAULT_WEB_PORT = 4141;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function parseLaunchArgs(argv: readonly string[]): ParsedLaunchArgs {
  if (!argv.includes("--web")) {
    const parsed = parseHeadlessArgs(argv);
    if (parsed.error) {
      return { mode: "error", error: parsed.error };
    }

    return parsed.mode === "headless" && parsed.options
      ? { mode: "headless", options: parsed.options }
      : { mode: "interactive" };
  }

  let host = DEFAULT_WEB_HOST;
  let port = DEFAULT_WEB_PORT;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--web") {
      continue;
    }

    if (arg === "--port") {
      const value = argv[index + 1];
      if (!value) {
        return { mode: "error", error: "--port requires a numeric value." };
      }

      const parsedPort = Number(value);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
        return { mode: "error", error: `Invalid port: ${value}` };
      }

      port = parsedPort;
      index += 1;
      continue;
    }

    if (arg === "--host") {
      const value = argv[index + 1];
      if (!value) {
        return { mode: "error", error: "--host requires a local host value." };
      }

      if (!LOCAL_HOSTS.has(value)) {
        return { mode: "error", error: `Unsafe web host: ${value}. Use 127.0.0.1, localhost, or ::1.` };
      }

      host = value;
      index += 1;
      continue;
    }

    if (arg === "--print" || arg === "--json" || arg === "--yes-safe") {
      return { mode: "error", error: `${arg} cannot be used with --web.` };
    }

    if (arg.startsWith("-")) {
      return { mode: "error", error: `Unknown option: ${arg}` };
    }

    return { mode: "error", error: "--web does not accept prompt arguments." };
  }

  return {
    mode: "web",
    options: {
      host,
      port
    }
  };
}
