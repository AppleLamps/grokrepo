import type { ContextBuilder } from "../context/index.js";
import type { GrokProvider, GrokUsage } from "../providers/grok.js";
import type { ImageProviderLike, SearchProviderLike } from "../tools/index.js";
import { classifyShellCommand, type ToolRegistry } from "../tools/index.js";
import type { ToolApprovalDecision } from "../tools/types.js";
import { runChatTurn, type ToolApprovalRequest, type ToolRuntimeEvent, type VerificationRuntimeStatus } from "./chat.js";
import type { ContextRuntimeMetadata } from "./summarization.js";
import type { Session } from "./session.js";

export interface HeadlessOptions {
  prompt: string;
  output: "plain" | "json";
  yesSafe: boolean;
}

export interface ParsedHeadlessArgs {
  mode: "interactive" | "headless";
  options?: HeadlessOptions;
  error?: string;
}

export interface HeadlessRunResult {
  content: string;
  exitCode: number;
  usage?: GrokUsage;
  context?: ContextRuntimeMetadata;
  verification?: VerificationRuntimeStatus;
  toolEvents: ToolRuntimeEvent[];
}

export interface RunHeadlessTurnOptions {
  session: Session;
  provider: Pick<GrokProvider, "streamChat"> & Partial<Pick<GrokProvider, "summarizeConversation">>;
  registry: ToolRegistry;
  cwd: string;
  prompt: string;
  yesSafe?: boolean;
  contextBuilder?: ContextBuilder;
  imageProvider?: ImageProviderLike;
  searchProvider?: SearchProviderLike;
  onSessionChange?: (session: Session) => void | Promise<void>;
}

export function parseHeadlessArgs(argv: readonly string[]): ParsedHeadlessArgs {
  const positional: string[] = [];
  let output: HeadlessOptions["output"] = "plain";
  let yesSafe = false;

  for (const arg of argv) {
    if (arg === "--print") {
      output = "plain";
      continue;
    }

    if (arg === "--json") {
      output = "json";
      continue;
    }

    if (arg === "--yes-safe") {
      yesSafe = true;
      continue;
    }

    if (arg.startsWith("-")) {
      return {
        mode: "headless",
        error: `Unknown option: ${arg}`
      };
    }

    positional.push(arg);
  }

  if (positional.length === 0 && output === "plain" && !yesSafe) {
    return { mode: "interactive" };
  }

  const prompt = positional.join(" ").trim();
  if (!prompt) {
    return {
      mode: "headless",
      error: "Headless mode requires a prompt argument."
    };
  }

  return {
    mode: "headless",
    options: {
      prompt,
      output,
      yesSafe
    }
  };
}

export async function runHeadlessTurn(options: RunHeadlessTurnOptions): Promise<HeadlessRunResult> {
  const toolEvents: ToolRuntimeEvent[] = [];
  let content = "";
  options.session.addUserMessage(options.prompt);

  const result = await runChatTurn({
    session: options.session,
    provider: options.provider,
    registry: options.registry,
    cwd: options.cwd,
    contextBuilder: options.contextBuilder,
    imageProvider: options.imageProvider,
    searchProvider: options.searchProvider,
    onSessionChange: options.onSessionChange,
    onDelta: (delta) => {
      content += delta;
    },
    onToolEvent: (event) => {
      toolEvents.push(event);
    },
    requestApproval: async (request) => headlessApprovalDecision(request, Boolean(options.yesSafe))
  });

  return {
    content: result.content || content,
    usage: result.usage,
    context: result.context,
    verification: result.verification,
    toolEvents,
    exitCode: headlessExitCode(toolEvents)
  };
}

export function renderHeadlessJson(result: HeadlessRunResult): string {
  return `${JSON.stringify({
    content: result.content,
    exitCode: result.exitCode,
    usage: result.usage,
    context: result.context,
    verification: result.verification,
    toolEvents: result.toolEvents
  }, null, 2)}\n`;
}

function headlessApprovalDecision(request: ToolApprovalRequest, yesSafe: boolean): ToolApprovalDecision {
  if (!yesSafe || !isAllowedYesSafeTool(request)) {
    return { approved: false };
  }

  return {
    approved: true,
    strongConfirmation: false
  };
}

function isAllowedYesSafeTool(request: ToolApprovalRequest): boolean {
  if (request.tool.name === "verify_changes") {
    return true;
  }

  if (request.tool.name !== "run_shell") {
    return false;
  }

  const args = request.call.parsedArguments;
  if (typeof args !== "object" || args === null) {
    return false;
  }

  const command = (args as Record<string, unknown>).command;
  if (typeof command !== "string") {
    return false;
  }

  return classifyShellCommand(command).level === "safe" && isVerificationLikeCommand(command);
}

function isVerificationLikeCommand(command: string): boolean {
  return /\b(?:test|typecheck|lint|build)\b/.test(command.toLowerCase()) || command.toLowerCase().startsWith("node --test");
}

function headlessExitCode(events: readonly ToolRuntimeEvent[]): number {
  if (events.some((event) => event.result?.error?.code === "verification_failed")) {
    return 3;
  }

  if (events.some((event) =>
    event.status === "denied" ||
    event.result?.error?.code === "approval_denied" ||
    event.result?.error?.code === "plan_mode_blocked" ||
    event.result?.error?.code === "strong_confirmation_required"
  )) {
    return 2;
  }

  return 0;
}
