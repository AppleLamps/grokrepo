import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { runFileCommand } from "../tools/process.js";
import type { RepoScanResult } from "./types.js";

const LOCKFILES: Array<[string, string]> = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"]
];

const KEY_FILE_CANDIDATES = [
  "package.json",
  "tsconfig.json",
  "README.md",
  "plan.md",
  "src/index.ts",
  "src/cli/app.tsx"
];

export async function scanRepo(cwd: string): Promise<RepoScanResult> {
  const packageJson = await readPackageJson(cwd);
  const keyFiles = await existingFiles(cwd, KEY_FILE_CANDIDATES);

  return {
    cwd,
    packageManager: await detectPackageManager(cwd),
    frameworks: await detectFrameworks(cwd, packageJson),
    entrypoints: await detectEntrypoints(cwd, packageJson),
    keyFiles,
    git: await readGitMetadata(cwd)
  };
}

async function detectPackageManager(cwd: string): Promise<string | undefined> {
  for (const [lockfile, packageManager] of LOCKFILES) {
    if (await pathExists(path.join(cwd, lockfile))) {
      return packageManager;
    }
  }

  return undefined;
}

async function detectFrameworks(cwd: string, packageJson: PackageJson | undefined): Promise<string[]> {
  const dependencyNames = new Set(Object.keys({
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  }));
  const frameworks = new Set<string>();

  if (dependencyNames.has("typescript") || await pathExists(path.join(cwd, "tsconfig.json"))) {
    frameworks.add("TypeScript");
  }

  if (dependencyNames.has("react")) {
    frameworks.add("React");
  }

  if (dependencyNames.has("ink")) {
    frameworks.add("Ink");
  }

  if (dependencyNames.has("vite")) {
    frameworks.add("Vite");
  }

  if (dependencyNames.has("next")) {
    frameworks.add("Next.js");
  }

  if (dependencyNames.has("express")) {
    frameworks.add("Express");
  }

  if (packageJson?.bin || await pathExists(path.join(cwd, "src", "index.ts"))) {
    frameworks.add("Node CLI");
  }

  return [...frameworks].sort();
}

async function detectEntrypoints(cwd: string, packageJson: PackageJson | undefined): Promise<string[]> {
  const entrypoints = new Set<string>();

  addPackageFieldEntrypoints(entrypoints, packageJson?.bin);
  addPackageFieldEntrypoints(entrypoints, packageJson?.main);
  addPackageFieldEntrypoints(entrypoints, packageJson?.exports);

  for (const candidate of ["src/index.ts", "src/index.tsx", "src/main.ts", "src/cli/app.tsx"]) {
    if (await pathExists(path.join(cwd, candidate))) {
      entrypoints.add(candidate);
    }
  }

  return [...entrypoints].sort();
}

function addPackageFieldEntrypoints(entrypoints: Set<string>, value: unknown): void {
  if (typeof value === "string") {
    entrypoints.add(value);
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    addPackageFieldEntrypoints(entrypoints, nestedValue);
  }
}

async function readGitMetadata(cwd: string): Promise<RepoScanResult["git"]> {
  const root = await runFileCommand("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 10_000 });

  if (root.exitCode !== 0) {
    return {
      isRepo: false,
      status: [],
      recentFiles: []
    };
  }

  const branch = await runFileCommand("git", ["branch", "--show-current"], { cwd, timeoutMs: 10_000 });
  const status = await runFileCommand("git", ["status", "--short"], { cwd, timeoutMs: 10_000 });
  const recent = await runFileCommand("git", ["log", "--name-only", "--pretty=format:", "-20"], { cwd, timeoutMs: 10_000 });

  return {
    isRepo: true,
    branch: branch.stdout.trim() || undefined,
    status: status.stdout.split(/\r?\n/).filter(Boolean),
    recentFiles: unique(recent.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).slice(0, 40)
  };
}

async function readPackageJson(cwd: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

async function existingFiles(cwd: string, candidates: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const candidate of candidates) {
    if (await pathExists(path.join(cwd, candidate))) {
      files.push(candidate);
    }
  }

  return files;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

interface PackageJson {
  bin?: unknown;
  main?: unknown;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
