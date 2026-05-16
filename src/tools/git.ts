import { getString } from "./args.js";
import { runFileCommand } from "./process.js";
import { toolFailure, toolSuccess, type Tool } from "./types.js";

export function createGitTools(): Tool[] {
  return [gitStatusTool, gitDiffTool, gitCommitTool];
}

const gitStatusTool: Tool = {
  name: "git_status",
  description: "Show concise git working tree status for the current workspace.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    const result = await runFileCommand("git", ["status", "--short"], { cwd: context.cwd });
    return commandEnvelope("git_status", result);
  }
};

const gitDiffTool: Tool = {
  name: "git_diff",
  description: "Show the current unstaged and staged git diff for the workspace.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    const unstaged = await runFileCommand("git", ["diff"], { cwd: context.cwd });
    const staged = await runFileCommand("git", ["diff", "--staged"], { cwd: context.cwd });
    const output = {
      stdout: renderCombinedDiff(unstaged.stdout, staged.stdout),
      stderr: [unstaged.stderr, staged.stderr].filter(Boolean).join("\n"),
      exitCode: unstaged.exitCode === 0 && staged.exitCode === 0 ? 0 : unstaged.exitCode || staged.exitCode,
      unstaged,
      staged
    };

    if (output.exitCode === 0) {
      return toolSuccess("git_diff", output);
    }

    return toolFailure("git_diff", "command_failed", output.stderr || `git_diff exited with code ${output.exitCode}.`, output);
  }
};

const gitCommitTool: Tool = {
  name: "git_commit",
  description: "Create a git commit with an explicit message after user approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Commit message to pass to git commit -m."
      }
    },
    required: ["message"],
    additionalProperties: false
  },
  async execute(args, context) {
    const message = getString(args, "message");

    if (!message) {
      return toolFailure("git_commit", "invalid_arguments", "git_commit requires a string message.");
    }

    const result = await runFileCommand("git", ["commit", "-m", message], { cwd: context.cwd });
    return commandEnvelope("git_commit", result);
  }
};

function commandEnvelope(tool: string, result: { stdout: string; stderr: string; exitCode: number }) {
  const output = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };

  if (result.exitCode === 0) {
    return toolSuccess(tool, output);
  }

  return toolFailure(tool, "command_failed", result.stderr || `${tool} exited with code ${result.exitCode}.`, {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  });
}

function renderCombinedDiff(unstaged: string, staged: string): string {
  return [
    "## unstaged",
    unstaged.trimEnd() || "(no unstaged changes)",
    "",
    "## staged",
    staged.trimEnd() || "(no staged changes)"
  ].join("\n");
}
