import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getOptionalString, getString, isRecord } from "./args.js";
import { runFileCommand } from "./process.js";
import { resolveWorkspacePath, toWorkspaceRelativePath } from "./path.js";
import { toolFailure, toolSuccess, type Tool } from "./types.js";

export function createGitTools(): Tool[] {
  return [gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitShowTool, gitDiffFileTool, gitStageTool, gitRestoreTool, gitCommitTool];
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

const gitLogTool: Tool = {
  name: "git_log",
  description: "Show recent git commits for the current workspace.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      maxCount: {
        type: "number",
        description: "Maximum commits to return. Defaults to 10."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const maxCount = Math.min(getOptionalPositiveInteger(args, "maxCount") ?? 10, 50);
    const result = await runFileCommand("git", ["log", `--max-count=${maxCount}`, "--date=short", "--pretty=format:%H%x1f%h%x1f%ad%x1f%an%x1f%s"], { cwd: context.cwd });

    if (result.exitCode !== 0) {
      return commandEnvelope("git_log", result);
    }

    const commits = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, date, author, subject] = line.split("\u001f");
        return { hash, shortHash, date, author, subject };
      });

    return toolSuccess("git_log", {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      commits
    });
  }
};

const gitBranchTool: Tool = {
  name: "git_branch",
  description: "Show the current git branch and local branches.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    const current = await runFileCommand("git", ["branch", "--show-current"], { cwd: context.cwd });
    const branches = await runFileCommand("git", ["branch", "--format=%(refname:short)"], { cwd: context.cwd });
    const output = {
      stdout: branches.stdout,
      stderr: [current.stderr, branches.stderr].filter(Boolean).join("\n"),
      exitCode: current.exitCode === 0 && branches.exitCode === 0 ? 0 : current.exitCode || branches.exitCode,
      current: current.stdout.trim() || undefined,
      branches: branches.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    };

    if (output.exitCode === 0) {
      return toolSuccess("git_branch", output);
    }

    return toolFailure("git_branch", "command_failed", output.stderr || `git_branch exited with code ${output.exitCode}.`, output);
  }
};

const gitShowTool: Tool = {
  name: "git_show",
  description: "Show a git object, commit, or file at a revision.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description: "Git ref/object to show. Defaults to HEAD."
      },
      path: {
        type: "string",
        description: "Optional file path at the ref."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const ref = getOptionalString(args, "ref") ?? "HEAD";
    const filePath = getOptionalString(args, "path");
    const target = filePath ? `${ref}:${filePath}` : ref;
    const result = await runFileCommand("git", ["show", "--stat", "--patch", target], { cwd: context.cwd });
    return commandEnvelope("git_show", result);
  }
};

const gitDiffFileTool: Tool = {
  name: "git_diff_file",
  description: "Show git diff for a single workspace file.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative file path to diff."
      },
      staged: {
        type: "boolean",
        description: "When true, show staged diff for the file."
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(args, context) {
    const filePath = getString(args, "path");
    if (!filePath) {
      return toolFailure("git_diff_file", "invalid_arguments", "git_diff_file requires a string path.");
    }

    const staged = isRecord(args) && args.staged === true;
    const result = await runFileCommand("git", ["diff", ...(staged ? ["--staged"] : []), "--", filePath], { cwd: context.cwd });
    return commandEnvelope("git_diff_file", result);
  }
};

const gitStageTool: Tool = {
  name: "git_stage",
  description: "Stage selected files with git add after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        description: "Workspace-relative paths to stage.",
        items: { type: "string" }
      }
    },
    required: ["paths"],
    additionalProperties: false
  },
  async execute(args, context) {
    const paths = getStringArray(args, "paths");
    if (!paths || paths.length === 0) {
      return toolFailure("git_stage", "invalid_arguments", "git_stage requires a non-empty paths array.");
    }

    if (paths.some((filePath) => filePath.includes("..") || filePath.startsWith("/") || filePath.startsWith("\\"))) {
      return toolFailure("git_stage", "path_outside_workspace", "git_stage paths must be workspace-relative.");
    }

    const result = await runFileCommand("git", ["add", "--", ...paths], { cwd: context.cwd });
    const envelope = commandEnvelope("git_stage", result);

    if (envelope.ok) {
      return toolSuccess("git_stage", {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        stagedPaths: paths
      });
    }

    return envelope;
  }
};

const gitRestoreTool: Tool = {
  name: "git_restore",
  description: "Restore or unstage selected git paths after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        description: "Workspace-relative paths to restore or unstage.",
        items: { type: "string" }
      },
      staged: {
        type: "boolean",
        description: "When true, unstage paths from the index instead of restoring worktree files."
      },
      source: {
        type: "string",
        description: "Optional source ref for worktree restore. Defaults to HEAD."
      }
    },
    required: ["paths"],
    additionalProperties: false
  },
  async execute(args, context) {
    const paths = getStringArray(args, "paths");
    if (!paths || paths.length === 0) {
      return toolFailure("git_restore", "invalid_arguments", "git_restore requires a non-empty paths array.");
    }

    if (!validateGitPaths(paths)) {
      return toolFailure("git_restore", "path_outside_workspace", "git_restore paths must be workspace-relative.");
    }

    const staged = isRecord(args) && args.staged === true;
    const source = getOptionalString(args, "source") ?? "HEAD";

    try {
      const backup = staged ? undefined : await createGitRestoreBackup(context.cwd, paths);
      const commandArgs = staged
        ? ["restore", "--staged", "--", ...paths]
        : ["restore", "--source", source, "--", ...paths];
      const result = await runFileCommand("git", commandArgs, { cwd: context.cwd });

      if (result.exitCode !== 0) {
        return toolFailure("git_restore", "command_failed", result.stderr || `git_restore exited with code ${result.exitCode}.`, {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          backup
        });
      }

      return toolSuccess("git_restore", {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        paths,
        staged,
        source: staged ? null : source,
        backup: backup ?? null
      });
    } catch (cause) {
      return toolFailure("git_restore", "restore_failed", errorMessage(cause));
    }
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

function getOptionalPositiveInteger(args: unknown, key: string): number | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function getStringArray(args: unknown, key: string): string[] | undefined {
  if (!isRecord(args) || !Array.isArray(args[key])) {
    return undefined;
  }

  return args[key].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function validateGitPaths(paths: readonly string[]): boolean {
  return paths.every((filePath) =>
    filePath.length > 0 &&
    !filePath.includes("..") &&
    !filePath.startsWith("/") &&
    !filePath.startsWith("\\")
  );
}

async function createGitRestoreBackup(cwd: string, paths: string[]): Promise<{
  id: string;
  files: Array<{ path: string; existed: boolean; backupPath?: string }>;
}> {
  const id = `git_restore_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
  const root = path.join(cwd, ".workspace", "git-restore", id);
  const fileRoot = path.join(root, "files");
  await mkdir(fileRoot, { recursive: true });

  const files: Array<{ path: string; existed: boolean; backupPath?: string }> = [];
  for (const filePath of paths) {
    const resolved = resolveWorkspacePath(cwd, filePath);
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    if (!await pathExists(resolved.path)) {
      files.push({ path: filePath, existed: false });
      continue;
    }

    const fileStat = await stat(resolved.path);
    if (!fileStat.isFile()) {
      files.push({ path: filePath, existed: true });
      continue;
    }

    const backupPath = path.join(fileRoot, filePath);
    await mkdir(path.dirname(backupPath), { recursive: true });
    await copyFile(resolved.path, backupPath);
    files.push({
      path: filePath,
      existed: true,
      backupPath: toWorkspaceRelativePath(cwd, backupPath)
    });
  }

  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({ id, createdAt: new Date().toISOString(), files }, null, 2)}\n`, "utf8");
  return { id, files };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
