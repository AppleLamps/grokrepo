import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "../tools/path.js";
import { toolFailure, toolSuccess, type ToolExecutionContext, type ToolExecutionResult } from "../tools/types.js";
import { createBackupId, createPatchBackup, restorePatchBackup } from "./backups.js";
import { applyPatchToContent, parseUnifiedDiff, type PatchFile } from "./diff.js";

export interface ApplyPatchArgs {
  patch?: string;
  summary?: string;
}

export interface UndoPatchArgs {
  backupId?: string;
}

export interface PatchPreview {
  files: string[];
  summary?: string;
  diff: string;
}

export function createPatchPreview(args: unknown): PatchPreview | undefined {
  if (!isRecord(args) || typeof args.patch !== "string") {
    return undefined;
  }

  try {
    const parsed = parseUnifiedDiff(args.patch);

    return {
      files: parsed.files.map((file) => file.path),
      summary: typeof args.summary === "string" ? args.summary : undefined,
      diff: args.patch
    };
  } catch {
    return undefined;
  }
}

export async function applyPatch(args: ApplyPatchArgs, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  if (!args.patch) {
    return toolFailure("apply_patch", "invalid_arguments", "apply_patch requires a patch string.");
  }

  let patchFiles: PatchFile[];

  try {
    patchFiles = parseUnifiedDiff(args.patch).files;
  } catch (cause) {
    return toolFailure("apply_patch", "invalid_patch", errorMessage(cause));
  }

  const approvedFiles = context.approval?.approvedFiles ?? patchFiles.map((file) => file.path);
  const selectedFiles = patchFiles.filter((file) => approvedFiles.includes(file.path));
  const skippedFiles = patchFiles.filter((file) => !approvedFiles.includes(file.path)).map((file) => file.path);

  if (selectedFiles.length === 0) {
    return toolSuccess("apply_patch", {
      appliedFiles: [],
      skippedFiles,
      backupId: null,
      summary: args.summary ?? null
    });
  }

  const validation = await validatePatchFiles(context.cwd, selectedFiles);
  if (!validation.ok) {
    return validation.result;
  }

  const backupId = createBackupId();
  const touchedFiles = selectedFiles.map((file) => file.path);

  try {
    await createPatchBackup(context.cwd, backupId, touchedFiles, args.patch);

    for (const file of selectedFiles) {
      await applyPatchFile(context.cwd, file);
    }

    return toolSuccess("apply_patch", {
      appliedFiles: touchedFiles,
      skippedFiles,
      backupId,
      summary: args.summary ?? null
    });
  } catch (cause) {
    try {
      await restorePatchBackup(context.cwd, backupId);
    } catch {
      return toolFailure("apply_patch", "rollback_failed", errorMessage(cause), { backupId });
    }

    return toolFailure("apply_patch", "apply_failed", errorMessage(cause), { backupId, rolledBack: true });
  }
}

export async function undoPatch(args: UndoPatchArgs, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  try {
    const manifest = await restorePatchBackup(context.cwd, args.backupId);

    return toolSuccess("undo_patch", {
      backupId: manifest.id,
      restoredFiles: manifest.files.map((file) => file.path)
    });
  } catch (cause) {
    return toolFailure("undo_patch", "undo_failed", errorMessage(cause));
  }
}

async function validatePatchFiles(
  cwd: string,
  files: PatchFile[]
): Promise<{ ok: true } | { ok: false; result: ToolExecutionResult }> {
  const seen = new Set<string>();

  for (const file of files) {
    if (seen.has(file.path)) {
      return {
        ok: false,
        result: toolFailure("apply_patch", "invalid_patch", `Patch contains duplicate file changes: ${file.path}`)
      };
    }

    seen.add(file.path);

    const resolved = resolveWorkspacePath(cwd, file.path);

    if (!resolved.ok) {
      return {
        ok: false,
        result: toolFailure("apply_patch", "path_outside_workspace", resolved.error)
      };
    }

    if (file.kind !== "create" && !(await fileExists(resolved.path))) {
      return {
        ok: false,
        result: toolFailure("apply_patch", "missing_file", `Patch target does not exist: ${file.path}`)
      };
    }

    if (await isBinaryFile(resolved.path)) {
      return {
        ok: false,
        result: toolFailure("apply_patch", "binary_file", `Binary files are not supported in Phase 3: ${file.path}`)
      };
    }
  }

  return { ok: true };
}

async function applyPatchFile(cwd: string, file: PatchFile): Promise<void> {
  const resolved = resolveWorkspacePath(cwd, file.path);

  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const current = file.kind === "create" ? "" : await readFile(resolved.path, "utf8");
  const updated = applyPatchToContent(file, current);

  if (file.kind === "delete") {
    await rm(resolved.path, { force: true });
    return;
  }

  await mkdir(path.dirname(resolved.path), { recursive: true });
  await writeFile(resolved.path, updated, "utf8");
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function isBinaryFile(file: string): Promise<boolean> {
  if (!(await fileExists(file))) {
    return false;
  }

  const buffer = await readFile(file);
  return buffer.includes(0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
