import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getOptionalString, getString, isRecord } from "./args.js";
import { resolveWorkspacePath, toWorkspaceRelativePath } from "./path.js";
import { toolFailure, toolSuccess, type Tool } from "./types.js";

export function createFileOperationTools(): Tool[] {
  return [fileInfoTool, createDirectoryTool, copyFileTool, moveFileTool, deleteFileTool];
}

const fileInfoTool: Tool = {
  name: "file_info",
  description: "Inspect workspace file or directory metadata.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path to inspect."
      },
      includeHash: {
        type: "boolean",
        description: "When true, include a SHA-256 hash for files."
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getString(args, "path");
    if (!requestedPath) {
      return toolFailure("file_info", "invalid_arguments", "file_info requires a string path.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("file_info", "path_outside_workspace", resolved.error);
    }

    try {
      const fileStat = await stat(resolved.path);
      const type = fileStat.isDirectory() ? "directory" : fileStat.isFile() ? "file" : "other";
      const includeHash = isRecord(args) && args.includeHash === true && type === "file";
      const hash = includeHash ? createHash("sha256").update(await readFile(resolved.path)).digest("hex") : undefined;

      return toolSuccess("file_info", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path),
        type,
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        ...(hash ? { sha256: hash } : {})
      });
    } catch (cause) {
      return toolFailure("file_info", "stat_failed", errorMessage(cause));
    }
  }
};

const createDirectoryTool: Tool = {
  name: "create_directory",
  description: "Create a workspace directory after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative directory path to create."
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getString(args, "path");
    if (!requestedPath) {
      return toolFailure("create_directory", "invalid_arguments", "create_directory requires a string path.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("create_directory", "path_outside_workspace", resolved.error);
    }

    try {
      await mkdir(resolved.path, { recursive: true });
      return toolSuccess("create_directory", {
        path: toWorkspaceRelativePath(context.cwd, resolved.path)
      });
    } catch (cause) {
      return toolFailure("create_directory", "mkdir_failed", errorMessage(cause));
    }
  }
};

const copyFileTool: Tool = {
  name: "copy_file",
  description: "Copy a file within the workspace after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Workspace-relative source file."
      },
      destination: {
        type: "string",
        description: "Workspace-relative destination file."
      },
      overwrite: {
        type: "boolean",
        description: "Allow overwriting an existing destination. Defaults to false."
      }
    },
    required: ["source", "destination"],
    additionalProperties: false
  },
  async execute(args, context) {
    const paths = resolveOperationPaths(context.cwd, args, "source", "destination", "copy_file");
    if (!paths.ok) {
      return paths.result;
    }

    try {
      if (!await isFile(paths.source)) {
        return toolFailure("copy_file", "not_file", `Source is not a file: ${paths.sourceRelative}`);
      }

      const overwrite = isRecord(args) && args.overwrite === true;
      if (!overwrite && await pathExists(paths.destination)) {
        return toolFailure("copy_file", "destination_exists", `Destination already exists: ${paths.destinationRelative}`);
      }

      await mkdir(path.dirname(paths.destination), { recursive: true });
      await copyFile(paths.source, paths.destination);
      const copiedStat = await stat(paths.destination);

      return toolSuccess("copy_file", {
        source: paths.sourceRelative,
        destination: paths.destinationRelative,
        overwritten: overwrite,
        bytes: copiedStat.size
      });
    } catch (cause) {
      return toolFailure("copy_file", "copy_failed", errorMessage(cause));
    }
  }
};

const moveFileTool: Tool = {
  name: "move_file",
  description: "Move or rename a workspace file after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Workspace-relative source path."
      },
      destination: {
        type: "string",
        description: "Workspace-relative destination path."
      },
      overwrite: {
        type: "boolean",
        description: "Allow overwriting an existing destination. Defaults to false."
      }
    },
    required: ["source", "destination"],
    additionalProperties: false
  },
  async execute(args, context) {
    const paths = resolveOperationPaths(context.cwd, args, "source", "destination", "move_file");
    if (!paths.ok) {
      return paths.result;
    }

    try {
      const overwrite = isRecord(args) && args.overwrite === true;
      if (!await pathExists(paths.source)) {
        return toolFailure("move_file", "missing_source", `Source does not exist: ${paths.sourceRelative}`);
      }

      if (!overwrite && await pathExists(paths.destination)) {
        return toolFailure("move_file", "destination_exists", `Destination already exists: ${paths.destinationRelative}`);
      }

      if (overwrite) {
        await rm(paths.destination, { recursive: true, force: true });
      }

      await mkdir(path.dirname(paths.destination), { recursive: true });
      await rename(paths.source, paths.destination);

      return toolSuccess("move_file", {
        source: paths.sourceRelative,
        destination: paths.destinationRelative,
        overwritten: overwrite
      });
    } catch (cause) {
      return toolFailure("move_file", "move_failed", errorMessage(cause));
    }
  }
};

const deleteFileTool: Tool = {
  name: "delete_file",
  description: "Soft-delete a workspace file or directory into .workspace/trash after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path to soft-delete."
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getString(args, "path");
    if (!requestedPath) {
      return toolFailure("delete_file", "invalid_arguments", "delete_file requires a string path.");
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath);
    if (!resolved.ok) {
      return toolFailure("delete_file", "path_outside_workspace", resolved.error);
    }

    const relativePath = toWorkspaceRelativePath(context.cwd, resolved.path);
    if (relativePath === "." || relativePath.startsWith(".workspace/")) {
      return toolFailure("delete_file", "protected_path", "delete_file cannot delete the workspace root or .workspace.");
    }

    try {
      if (!await pathExists(resolved.path)) {
        return toolFailure("delete_file", "missing_path", `Path does not exist: ${relativePath}`);
      }

      const trashId = createTrashId();
      const trashRoot = path.join(context.cwd, ".workspace", "trash", trashId);
      const trashPath = path.join(trashRoot, "files", relativePath);
      const fileStat = await stat(resolved.path);
      await mkdir(path.dirname(trashPath), { recursive: true });
      await rename(resolved.path, trashPath);

      const manifest = {
        id: trashId,
        originalPath: relativePath,
        trashPath: toWorkspaceRelativePath(context.cwd, trashPath),
        deletedAt: new Date().toISOString(),
        type: fileStat.isDirectory() ? "directory" : fileStat.isFile() ? "file" : "other",
        size: fileStat.size
      };
      await mkdir(trashRoot, { recursive: true });
      await writeFile(path.join(trashRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      return toolSuccess("delete_file", manifest);
    } catch (cause) {
      return toolFailure("delete_file", "delete_failed", errorMessage(cause));
    }
  }
};

function resolveOperationPaths(
  cwd: string,
  args: unknown,
  sourceKey: string,
  destinationKey: string,
  toolName: string
): { ok: true; source: string; destination: string; sourceRelative: string; destinationRelative: string } | { ok: false; result: ReturnType<typeof toolFailure> } {
  const source = getString(args, sourceKey);
  const destination = getString(args, destinationKey);
  if (!source || !destination) {
    return {
      ok: false,
      result: toolFailure(toolName, "invalid_arguments", `${toolName} requires string ${sourceKey} and ${destinationKey}.`)
    };
  }

  const resolvedSource = resolveWorkspacePath(cwd, source);
  if (!resolvedSource.ok) {
    return {
      ok: false,
      result: toolFailure(toolName, "path_outside_workspace", resolvedSource.error)
    };
  }

  const resolvedDestination = resolveWorkspacePath(cwd, destination);
  if (!resolvedDestination.ok) {
    return {
      ok: false,
      result: toolFailure(toolName, "path_outside_workspace", resolvedDestination.error)
    };
  }

  return {
    ok: true,
    source: resolvedSource.path,
    destination: resolvedDestination.path,
    sourceRelative: toWorkspaceRelativePath(cwd, resolvedSource.path),
    destinationRelative: toWorkspaceRelativePath(cwd, resolvedDestination.path)
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function createTrashId(): string {
  return `trash_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
