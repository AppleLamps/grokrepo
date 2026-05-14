import { getString } from "./args.js";
import { runShellCommand } from "./process.js";
import { toolFailure, toolSuccess, type Tool } from "./types.js";

export function createShellTools(): Tool[] {
  return [runShellTool];
}

const runShellTool: Tool = {
  name: "run_shell",
  description: "Run an exact shell command in the workspace after explicit user approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Exact shell command to execute."
      }
    },
    required: ["command"],
    additionalProperties: false
  },
  async execute(args, context) {
    const command = getString(args, "command");

    if (!command) {
      return toolFailure("run_shell", "invalid_arguments", "run_shell requires a string command.");
    }

    const result = await runShellCommand(command, { cwd: context.cwd });
    const output = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    };

    if (result.exitCode === 0) {
      return toolSuccess("run_shell", output);
    }

    return toolFailure("run_shell", "command_failed", result.stderr || `Command exited with code ${result.exitCode}.`, output);
  }
};
