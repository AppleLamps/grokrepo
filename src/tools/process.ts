import { exec, execFile } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runFileCommand(
  file: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<CommandResult> {
  if (options.signal?.aborted) {
    return Promise.resolve(abortedResult());
  }

  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 1024 * 1024 * 10,
        windowsHide: true,
        signal: options.signal
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

export function runShellCommand(command: string, options: { cwd: string; timeoutMs?: number; signal?: AbortSignal }): Promise<CommandResult> {
  if (options.signal?.aborted) {
    return Promise.resolve(abortedResult());
  }

  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 1024 * 1024 * 10,
        windowsHide: true,
        signal: options.signal
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

  if ("code" in error && error.code === "ABORT_ERR") {
    return 130;
  }

  return 127;
}

function abortedResult(): CommandResult {
  return {
    stdout: "",
    stderr: "Command aborted.",
    exitCode: 130
  };
}
