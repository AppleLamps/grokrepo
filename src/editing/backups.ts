import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "../tools/path.js";

export interface BackupManifestFile {
  path: string;
  existed: boolean;
  backupPath?: string;
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  files: BackupManifestFile[];
  patchPath?: string;
}

export function createBackupId(): string {
  return `patch_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createPatchBackup(cwd: string, id: string, files: string[], patch: string): Promise<BackupManifest> {
  const backupRoot = path.join(cwd, ".workspace", "patches", "backups", id);
  const fileRoot = path.join(backupRoot, "files");
  const patchDir = path.join(cwd, ".workspace", "patches", "patches");
  const patchPath = path.join(patchDir, `${id}.diff`);

  await mkdir(fileRoot, { recursive: true });
  await mkdir(patchDir, { recursive: true });

  const manifestFiles: BackupManifestFile[] = [];

  for (const file of files) {
    const resolved = resolveWorkspacePath(cwd, file);

    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    const backupPath = path.join(fileRoot, file);
    const exists = await fileExists(resolved.path);

    if (exists) {
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(resolved.path, backupPath);
      manifestFiles.push({
        path: file,
        existed: true,
        backupPath: path.relative(backupRoot, backupPath)
      });
    } else {
      manifestFiles.push({
        path: file,
        existed: false
      });
    }
  }

  const manifest: BackupManifest = {
    id,
    createdAt: new Date().toISOString(),
    files: manifestFiles,
    patchPath: path.relative(backupRoot, patchPath)
  };

  await writeFile(path.join(backupRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(cwd, ".workspace", "patches", "backups", "latest.json"), `${JSON.stringify({ id }, null, 2)}\n`, "utf8");
  await writeFile(patchPath, patch, "utf8");

  return manifest;
}

export async function restorePatchBackup(cwd: string, id?: string): Promise<BackupManifest> {
  const backupId = id ?? (await readLatestBackupId(cwd));
  const backupRoot = path.join(cwd, ".workspace", "patches", "backups", backupId);
  const manifest = JSON.parse(await readFile(path.join(backupRoot, "manifest.json"), "utf8")) as BackupManifest;

  for (const file of manifest.files) {
    const resolved = resolveWorkspacePath(cwd, file.path);

    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    if (file.existed && file.backupPath) {
      await mkdir(path.dirname(resolved.path), { recursive: true });
      await copyFile(path.join(backupRoot, file.backupPath), resolved.path);
    } else {
      await rm(resolved.path, { force: true });
    }
  }

  return manifest;
}

async function readLatestBackupId(cwd: string): Promise<string> {
  const raw = await readFile(path.join(cwd, ".workspace", "patches", "backups", "latest.json"), "utf8");
  const parsed = JSON.parse(raw) as { id?: string };

  if (!parsed.id) {
    throw new Error("No latest patch backup found.");
  }

  return parsed.id;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
