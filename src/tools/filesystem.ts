import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getOptionalString, getString } from "./args.js";
import { resolveWorkspacePath, toWorkspaceRelativePath } from "./path.js";
import { runFileCommand } from "./process.js";
import { toolFailure, toolSuccess, type Tool, type ToolExecutionContext, type ToolExecutionResult } from "./types.js";

export function createFilesystemTools(): Tool[] {
  return [readFileTool, listFilesTool, grepTool, writeFileTool];
}

const readFileTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 text file from the current workspace.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path to read."
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getString(args, "path");

    if (!requestedPath) {
      return toolFailure("read_file", "invalid_arguments", "read_file requires a string path.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("read_file", "path_outside_workspace", resolved.error);
    }

    try {
      const content = await readFile(resolved.path, "utf8");
      const fileStat = await stat(resolved.path);

      return toolSuccess("read_file", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path),
        size: fileStat.size,
        content
      });
    } catch (cause) {
      return toolFailure("read_file", "read_failed", errorMessage(cause));
    }
  }
};

const listFilesTool: Tool = {
  name: "list_files",
  description: "List files and directories inside a workspace directory.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative directory path. Defaults to the workspace root."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getOptionalString(args, "path") ?? ".";
    const resolved = resolveWorkspacePath(context.cwd, requestedPath);

    if (!resolved.ok) {
      return toolFailure("list_files", "path_outside_workspace", resolved.error);
    }

    try {
      const entries = await readdir(resolved.path, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const absolutePath = path.join(resolved.path, entry.name);
          const entryStat = await stat(absolutePath);

          return {
            name: entry.name,
            path: toWorkspaceRelativePath(context.cwd, absolutePath),
            type: entry.isDirectory() ? "directory" : "file",
            size: entryStat.size
          };
        })
      );

      return toolSuccess("list_files", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path),
        entries: files
      });
    } catch (cause) {
      return toolFailure("list_files", "list_failed", errorMessage(cause));
    }
  }
};

const grepTool: Tool = {
  name: "grep",
  description: "Search for text in workspace files. Uses ripgrep when available, with a deterministic Node fallback.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or ripgrep pattern to search for."
      },
      path: {
        type: "string",
        description: "Workspace-relative file or directory to search. Defaults to the workspace root."
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  async execute(args, context) {
    const query = getString(args, "query");
    const requestedPath = getOptionalString(args, "path") ?? ".";

    if (!query) {
      return toolFailure("grep", "invalid_arguments", "grep requires a string query.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("grep", "path_outside_workspace", resolved.error);
    }

    const rgResult = await runRipgrep(query, resolved.path, context);
    if (rgResult.ok || rgResult.error?.code !== "rg_unavailable") {
      return rgResult;
    }

    return runNodeGrep(query, resolved.path, context);
  }
};

const writeFileTool: Tool = {
  name: "write_file",
  description: "Write exact UTF-8 content to a workspace file after explicit user approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path to write."
      },
      content: {
        type: "string",
        description: "Exact UTF-8 content to write."
      }
    },
    required: ["path", "content"],
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getString(args, "path");
    const content = getString(args, "content");

    if (!requestedPath || content === undefined) {
      return toolFailure("write_file", "invalid_arguments", "write_file requires string path and content.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("write_file", "path_outside_workspace", resolved.error);
    }

    try {
      await mkdir(path.dirname(resolved.path), { recursive: true });
      await writeFile(resolved.path, content, "utf8");

      return toolSuccess("write_file", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path),
        bytes: Buffer.byteLength(content, "utf8")
      });
    } catch (cause) {
      return toolFailure("write_file", "write_failed", errorMessage(cause));
    }
  }
};

async function runRipgrep(
  query: string,
  absolutePath: string,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const result = await runFileCommand(
    "rg",
    ["--line-number", "--column", "--no-heading", "--color", "never", query, absolutePath],
    { cwd: context.cwd }
  );

  if (result.exitCode === 0 || result.exitCode === 1) {
    const matches = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => parseRipgrepLine(line, context.cwd));

    return toolSuccess("grep", {
      matches,
      truncated: result.stdout.split(/\r?\n/).filter(Boolean).length > matches.length
    });
  }

  if (result.stderr.toLowerCase().includes("not recognized") || result.stderr.toLowerCase().includes("not found")) {
    return toolFailure("grep", "rg_unavailable", "ripgrep is unavailable.");
  }

  return toolFailure("grep", "grep_failed", result.stderr || "ripgrep failed.", { exitCode: result.exitCode });
}

async function runNodeGrep(query: string, absolutePath: string, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const matches: Array<{ path: string; line: number; column: number; text: string }> = [];
  const pending = [absolutePath];

  while (pending.length > 0 && matches.length < 200) {
    const nextPath = pending.pop();
    if (!nextPath) {
      break;
    }

    const nextStat = await stat(nextPath);
    if (nextStat.isDirectory()) {
      if ([".git", "node_modules", "dist"].includes(path.basename(nextPath))) {
        continue;
      }

      const children = await readdir(nextPath);
      pending.push(...children.map((child) => path.join(nextPath, child)));
      continue;
    }

    if (!nextStat.isFile()) {
      continue;
    }

    let content: string;
    try {
      content = await readFile(nextPath, "utf8");
    } catch {
      continue;
    }

    content.split(/\r?\n/).forEach((line, index) => {
      const column = line.indexOf(query);

      if (column >= 0 && matches.length < 200) {
        matches.push({
          path: toWorkspaceRelativePath(context.cwd, nextPath),
          line: index + 1,
          column: column + 1,
          text: line
        });
      }
    });
  }

  return toolSuccess("grep", {
    matches,
    truncated: matches.length >= 200
  });
}

function parseRipgrepLine(line: string, cwd: string): { path: string; line: number; column: number; text: string } {
  const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);

  if (!match) {
    return {
      path: ".",
      line: 0,
      column: 0,
      text: line
    };
  }

  return {
    path: toWorkspaceRelativePath(cwd, match[1] ?? cwd),
    line: Number(match[2] ?? 0),
    column: Number(match[3] ?? 0),
    text: match[4] ?? ""
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
