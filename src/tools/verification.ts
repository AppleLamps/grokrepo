import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { getOptionalString } from "./args.js";
import { runShellCommand } from "./process.js";
import { classifyShellCommand, type ShellRisk } from "./shell-risk.js";
import { toolFailure, toolSuccess, type Tool, type ToolExecutionContext, type ToolExecutionResult } from "./types.js";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
type VerificationName = "typecheck" | "lint" | "test" | "build";

interface VerificationCommand {
  name: string;
  command: string;
  script?: string;
  packageManager?: PackageManager;
  risk: ShellRisk;
}

interface VerificationCommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsedMs: number;
}

const SCRIPT_ORDER: VerificationName[] = ["typecheck", "lint", "test", "build"];

export function createVerificationTools(): Tool[] {
  return [detectVerificationCommandsTool, verifyChangesTool];
}

const detectVerificationCommandsTool: Tool = {
  name: "detect_verification_commands",
  description: "Detect likely local verification commands from package metadata.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    return toolSuccess("detect_verification_commands", await detectVerificationCommands(context.cwd));
  }
};

const verifyChangesTool: Tool = {
  name: "verify_changes",
  description: "Run approved local verification commands sequentially and summarize the first failure.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      commands: {
        type: "array",
        description: "Optional exact verification commands. Defaults to detected package verification commands.",
        items: { type: "string" }
      },
      reason: {
        type: "string",
        description: "Short reason for running verification."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedCommands = getStringArray(args, "commands");
    const reason = getOptionalString(args, "reason");
    const detected = await detectVerificationCommands(context.cwd);
    const commands = requestedCommands?.map(commandToVerificationCommand) ?? detected.commands;

    if (commands.length === 0) {
      return toolFailure("verify_changes", "no_commands", "No verification commands were detected or provided.", { reason });
    }

    const rejected = commands.find((command) => !isAllowedVerificationRisk(command.risk));
    if (rejected) {
      return toolFailure(
        "verify_changes",
        "command_rejected",
        `Rejected verification command "${rejected.command}": ${rejected.risk.reason}`,
        {
          command: rejected.command,
          risk: rejected.risk
        }
      );
    }

    return runVerificationCommands(commands, context, reason);
  }
};

async function detectVerificationCommands(cwd: string): Promise<{
  packageManager: PackageManager;
  commands: VerificationCommand[];
  scripts: Record<string, string>;
}> {
  const packageManager = await detectPackageManager(cwd);
  const scripts = await readPackageScripts(cwd);
  const commands = SCRIPT_ORDER
    .filter((script) => typeof scripts[script] === "string")
    .map((script) => scriptToCommand(script, packageManager));

  return {
    packageManager,
    commands,
    scripts
  };
}

async function runVerificationCommands(
  commands: VerificationCommand[],
  context: ToolExecutionContext,
  reason: string | undefined
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const results: VerificationCommandResult[] = [];

  for (const command of commands) {
    const commandStartedAt = Date.now();
    const result = await runShellCommand(command.command, { cwd: context.cwd, signal: context.signal });
    const commandResult = {
      command: command.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      elapsedMs: Date.now() - commandStartedAt
    };
    results.push(commandResult);

    if (result.exitCode !== 0) {
      const summary = summarizeVerificationFailure(commandResult);
      return toolFailure("verify_changes", "verification_failed", summary, {
        reason,
        commands,
        results,
        failedCommand: command.command,
        failureSummary: summary,
        elapsedMs: Date.now() - startedAt
      });
    }
  }

  return toolSuccess("verify_changes", {
    reason,
    commands,
    results,
    elapsedMs: Date.now() - startedAt
  });
}

function commandToVerificationCommand(command: string): VerificationCommand {
  return {
    name: command,
    command,
    risk: classifyShellCommand(command)
  };
}

function scriptToCommand(script: VerificationName, packageManager: PackageManager): VerificationCommand {
  const command = packageManager === "npm"
    ? script === "test" ? "npm test" : `npm run ${script}`
    : `${packageManager} ${script}`;

  return {
    name: script,
    command,
    script,
    packageManager,
    risk: classifyShellCommand(command)
  };
}

async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const lockfiles: Array<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"]
  ];

  for (const [lockfile, packageManager] of lockfiles) {
    if (await pathExists(path.join(cwd, lockfile))) {
      return packageManager;
    }
  }

  return "npm";
}

async function readPackageScripts(cwd: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed.scripts)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

function isAllowedVerificationRisk(risk: ShellRisk): boolean {
  return risk.level === "safe";
}

function summarizeVerificationFailure(result: VerificationCommandResult): string {
  const detail = firstMeaningfulLine(result.stderr) ?? firstMeaningfulLine(result.stdout);
  return detail
    ? `${result.command} failed with exit code ${result.exitCode}: ${detail}`
    : `${result.command} failed with exit code ${result.exitCode}.`;
}

function firstMeaningfulLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function getStringArray(args: unknown, key: string): string[] | undefined {
  if (typeof args !== "object" || args === null || !(key in args)) {
    return undefined;
  }

  const value = (args as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
