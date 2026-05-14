import { exec, execFile } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runFileCommand(
  file: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 1024 * 1024 * 10,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr: stderr || (error instanceof Error ? error.message : ""),
          exitCode: getExitCode(error)
        });
      }
    );
  });
}

export function runShellCommand(command: string, options: { cwd: string; timeoutMs?: number }): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 1024 * 1024 * 10,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr: stderr || (error instanceof Error ? error.message : ""),
          exitCode: getExitCode(error)
        });
      }
    );
  });
}

function getExitCode(error: Error | null): number {
  if (!error) {
    return 0;
  }

  if ("code" in error && typeof error.code === "number") {
    return error.code;
  }

  return 127;
}
