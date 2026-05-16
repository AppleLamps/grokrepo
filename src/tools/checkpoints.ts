import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getOptionalString } from "./args.js";
import { resolveWorkspacePath } from "./path.js";
import { runFileCommand } from "./process.js";
import { toolFailure, toolSuccess, type Tool } from "./types.js";

interface CheckpointManifestFile {
  path: string;
  backupPath: string;
  size: number;
}

interface CheckpointManifest {
  id: string;
  name?: string;
  createdAt: string;
  files: CheckpointManifestFile[];
  changedFiles: string[];
  commandResults: unknown[];
  verificationResults: unknown[];
}

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".workspace"]);

export function createCheckpointTools(): Tool[] {
  return [checkpointCreateTool, checkpointListTool, checkpointRestoreTool];
}

const checkpointCreateTool: Tool = {
  name: "checkpoint_create",
  description: "Create a task checkpoint snapshot under .workspace/checkpoints after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Optional human-readable checkpoint name."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    try {
      const manifest = await createCheckpoint(context.cwd, getOptionalString(args, "name"));

      return toolSuccess("checkpoint_create", {
        id: manifest.id,
        name: manifest.name ?? null,
        createdAt: manifest.createdAt,
        fileCount: manifest.files.length,
        changedFiles: manifest.changedFiles
      });
    } catch (cause) {
      return toolFailure("checkpoint_create", "checkpoint_create_failed", errorMessage(cause));
    }
  }
};

const checkpointListTool: Tool = {
  name: "checkpoint_list",
  description: "List available task checkpoints from .workspace/checkpoints.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    try {
      const checkpoints = await listCheckpoints(context.cwd);

      return toolSuccess("checkpoint_list", {
        checkpoints: checkpoints.map((checkpoint) => ({
          id: checkpoint.id,
          name: checkpoint.name ?? null,
          createdAt: checkpoint.createdAt,
          fileCount: checkpoint.files.length,
          changedFiles: checkpoint.changedFiles
        }))
      });
    } catch (cause) {
      return toolFailure("checkpoint_list", "checkpoint_list_failed", errorMessage(cause));
    }
  }
};

const checkpointRestoreTool: Tool = {
  name: "checkpoint_restore",
  description: "Restore a task checkpoint after approval, replacing Git-visible workspace files with the checkpoint snapshot.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Checkpoint id to restore. Defaults to the latest checkpoint."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    try {
      const result = await restoreCheckpoint(context.cwd, getOptionalString(args, "id"));

      return toolSuccess("checkpoint_restore", result);
    } catch (cause) {
      return toolFailure("checkpoint_restore", "checkpoint_restore_failed", errorMessage(cause));
    }
  }
};

export async function createCheckpoint(cwd: string, name?: string): Promise<CheckpointManifest> {
  const id = createCheckpointId();
  const checkpointRoot = path.join(cwd, ".workspace", "checkpoints", id);
  const fileRoot = path.join(checkpointRoot, "files");
  const files = await listCheckpointCandidateFiles(cwd);
  const changedFiles = await listGitChangedFiles(cwd);

  await mkdir(fileRoot, { recursive: true });

  const manifestFiles: CheckpointManifestFile[] = [];
  for (const file of files) {
    const resolved = resolveWorkspacePath(cwd, file);
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    const fileStat = await stat(resolved.path);
    if (!fileStat.isFile()) {
      continue;
    }

    const backupPath = path.join("files", file);
    const absoluteBackupPath = path.join(checkpointRoot, backupPath);
    await mkdir(path.dirname(absoluteBackupPath), { recursive: true });
    await copyFile(resolved.path, absoluteBackupPath);
    manifestFiles.push({
      path: file,
      backupPath,
      size: fileStat.size
    });
  }

  const manifest: CheckpointManifest = {
    id,
    ...(name ? { name } : {}),
    createdAt: new Date().toISOString(),
    files: manifestFiles,
    changedFiles,
    commandResults: [],
    verificationResults: []
  };

  await writeManifest(checkpointRoot, manifest);
  await writeFile(latestCheckpointPath(cwd), `${JSON.stringify({ id }, null, 2)}\n`, "utf8");
  return manifest;
}

export async function listCheckpoints(cwd: string): Promise<CheckpointManifest[]> {
  const root = checkpointRoot(cwd);

  try {
    const entries = await readdir(root, { withFileTypes: true });
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readManifest(path.join(root, entry.name)))
    );

    return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (cause) {
    if (isMissingFileError(cause)) {
      return [];
    }

    throw cause;
  }
}

export async function restoreCheckpoint(cwd: string, id?: string): Promise<{
  id: string;
  name: string | null;
  restoredFiles: string[];
  removedFiles: string[];
}> {
  const checkpointId = id ?? await readLatestCheckpointId(cwd);
  const root = path.join(checkpointRoot(cwd), checkpointId);
  const manifest = await readManifest(root);
  const checkpointFiles = new Set(manifest.files.map((file) => file.path));
  const currentFiles = await listCheckpointCandidateFiles(cwd);
  const removedFiles: string[] = [];

  for (const file of currentFiles) {
    if (checkpointFiles.has(file)) {
      continue;
    }

    const resolved = resolveWorkspacePath(cwd, file);
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    await rm(resolved.path, { force: true });
    removedFiles.push(file);
  }

  for (const file of manifest.files) {
    const resolved = resolveWorkspacePath(cwd, file.path);
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    await mkdir(path.dirname(resolved.path), { recursive: true });
    await copyFile(path.join(root, file.backupPath), resolved.path);
  }

  return {
    id: manifest.id,
    name: manifest.name ?? null,
    restoredFiles: manifest.files.map((file) => file.path),
    removedFiles
  };
}

async function listCheckpointCandidateFiles(cwd: string): Promise<string[]> {
  const gitFiles = await runFileCommand("git", ["ls-files", "-co", "--exclude-standard"], { cwd, timeoutMs: 10_000 });

  if (gitFiles.exitCode === 0) {
    return unique(
      gitFiles.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !isIgnoredPath(line))
    ).sort();
  }

  return collectWorkspaceFiles(cwd);
}

async function listGitChangedFiles(cwd: string): Promise<string[]> {
  const result = await runFileCommand("git", ["status", "--short"], { cwd, timeoutMs: 10_000 });
  if (result.exitCode !== 0) {
    return [];
  }

  return unique(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
  ).sort();
}

async function collectWorkspaceFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [cwd];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(cwd, absolutePath).replaceAll(path.sep, "/"));
      }
    }
  }

  return files.sort();
}

async function readLatestCheckpointId(cwd: string): Promise<string> {
  const parsed = JSON.parse(await readFile(latestCheckpointPath(cwd), "utf8")) as { id?: string };
  if (!parsed.id) {
    throw new Error("No latest checkpoint found.");
  }

  return parsed.id;
}

async function readManifest(root: string): Promise<CheckpointManifest> {
  return JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as CheckpointManifest;
}

async function writeManifest(root: string, manifest: CheckpointManifest): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function checkpointRoot(cwd: string): string {
  return path.join(cwd, ".workspace", "checkpoints");
}

function latestCheckpointPath(cwd: string): string {
  return path.join(checkpointRoot(cwd), "latest.json");
}

function createCheckpointId(): string {
  return `checkpoint_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
}

function isIgnoredPath(file: string): boolean {
  return file.split(/[\\/]/).some((part) => IGNORED_DIRECTORIES.has(part));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isMissingFileError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
