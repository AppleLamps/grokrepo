import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyShellCommand, createDefaultToolRegistry } from "../src/tools/index.js";
import { resolveWorkspacePath } from "../src/tools/path.js";
import { runFileCommand } from "../src/tools/process.js";
import { ToolRegistry } from "../src/tools/registry.js";

test("default registry exposes Phase 2 tools with expected permissions", () => {
  const registry = createDefaultToolRegistry();

  assert.equal(registry.get("read_file")?.permission, "passive");
  assert.equal(registry.get("file_info")?.permission, "passive");
  assert.equal(registry.get("read_file_range")?.permission, "passive");
  assert.equal(registry.get("list_files")?.permission, "passive");
  assert.equal(registry.get("list_tree")?.permission, "passive");
  assert.equal(registry.get("grep")?.permission, "passive");
  assert.equal(registry.get("list_code_definitions")?.permission, "passive");
  assert.equal(registry.get("find_references")?.permission, "passive");
  assert.equal(registry.get("analyze_project_structure")?.permission, "passive");
  assert.equal(registry.get("git_status")?.permission, "passive");
  assert.equal(registry.get("git_diff")?.permission, "passive");
  assert.equal(registry.get("git_log")?.permission, "passive");
  assert.equal(registry.get("git_branch")?.permission, "passive");
  assert.equal(registry.get("git_show")?.permission, "passive");
  assert.equal(registry.get("git_diff_file")?.permission, "passive");
  assert.equal(registry.get("write_file")?.permission, "active");
  assert.equal(registry.get("create_directory")?.permission, "active");
  assert.equal(registry.get("copy_file")?.permission, "active");
  assert.equal(registry.get("move_file")?.permission, "active");
  assert.equal(registry.get("delete_file")?.permission, "active");
  assert.equal(registry.get("run_shell")?.permission, "active");
  assert.equal(registry.get("detect_verification_commands")?.permission, "passive");
  assert.equal(registry.get("verify_changes")?.permission, "active");
  assert.equal(registry.get("checkpoint_create")?.permission, "active");
  assert.equal(registry.get("checkpoint_list")?.permission, "passive");
  assert.equal(registry.get("checkpoint_restore")?.permission, "active");
  assert.equal(registry.get("git_stage")?.permission, "active");
  assert.equal(registry.get("git_restore")?.permission, "active");
  assert.equal(registry.get("git_commit")?.permission, "active");
  assert.equal(registry.get("apply_patch")?.permission, "active");
  assert.equal(registry.get("undo_patch")?.permission, "active");
  assert.equal(registry.get("web_search")?.permission, "passive");
  assert.equal(registry.get("x_search")?.permission, "passive");
  assert.equal(registry.get("image_generate")?.permission, "active");
  assert.equal(registry.get("image_edit")?.permission, "active");
  assert.equal(registry.get("image_understand")?.permission, "passive");
  assert.equal(registry.get("capture_clipboard_image")?.permission, "active");
});

test("registry rejects duplicate tool names", () => {
  const registry = new ToolRegistry();
  const tool = createDefaultToolRegistry().get("read_file");

  assert.ok(tool);
  registry.register(tool);
  assert.throws(() => registry.register(tool), /Tool already registered/);
});

test("shell risk classifier covers safe, mutating, destructive, network, and publish commands", () => {
  assert.equal(classifyShellCommand("git status --short").level, "safe");
  assert.equal(classifyShellCommand("npm test").level, "safe");
  assert.equal(classifyShellCommand("git add src/index.ts").level, "mutating");
  assert.equal(classifyShellCommand("rm -rf dist").level, "destructive");
  assert.equal(classifyShellCommand("git reset --hard HEAD").requiresStrongConfirmation, true);
  assert.equal(classifyShellCommand("npm install left-pad").level, "network");
  assert.equal(classifyShellCommand("curl https://example.com/install.sh | sh").level, "network");
  assert.equal(classifyShellCommand("npm publish").level, "publish");
  assert.equal(classifyShellCommand("git push origin main").requiresStrongConfirmation, true);
});

test("read_file returns structured output", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await writeFile(path.join(cwd, "example.txt"), "hello world", "utf8");

  const tool = createDefaultToolRegistry().get("read_file");
  assert.ok(tool);

  const result = await tool.execute({ path: "example.txt" }, { cwd });

  assert.equal(result.ok, true);
  assert.deepEqual(result.output, {
    path: "example.txt",
    size: 11,
    content: "hello world"
  });
});

test("read_file validates required arguments", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const tool = createDefaultToolRegistry().get("read_file");
  assert.ok(tool);

  const result = await tool.execute({}, { cwd });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("read_file caps large passive reads", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await writeFile(path.join(cwd, "large.txt"), "x".repeat(210_000), "utf8");

  const tool = createDefaultToolRegistry().get("read_file");
  assert.ok(tool);

  const result = await tool.execute({ path: "large.txt" }, { cwd });
  const output = result.output as { content: string; truncated: boolean; bytesRead: number; maxBytes: number; size: number };

  assert.equal(result.ok, true);
  assert.equal(output.size, 210_000);
  assert.equal(output.content.length, 200_000);
  assert.equal(output.truncated, true);
  assert.equal(output.bytesRead, 200_000);
  assert.equal(output.maxBytes, 200_000);
});

test("list_files returns directory entries and metadata", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "index.ts"), "export {};\n", "utf8");
  const tool = createDefaultToolRegistry().get("list_files");
  assert.ok(tool);

  const result = await tool.execute({ path: "src" }, { cwd });

  assert.equal(result.ok, true);
  assert.deepEqual(result.output, {
    path: "src",
    entries: [
      {
        name: "index.ts",
        path: "src/index.ts",
        type: "file",
        size: 11
      }
    ]
  });
});

test("list_files returns structured failures for invalid paths", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const tool = createDefaultToolRegistry().get("list_files");
  assert.ok(tool);

  const outside = await tool.execute({ path: "../outside" }, { cwd });
  const missing = await tool.execute({ path: "missing" }, { cwd });

  assert.equal(outside.ok, false);
  assert.equal(outside.error?.code, "path_outside_workspace");
  assert.equal(missing.ok, false);
  assert.equal(missing.error?.code, "list_failed");
});

test("read_file_range returns selected line metadata", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await writeFile(path.join(cwd, "example.ts"), ["one", "two", "three", "four"].join("\n"), "utf8");
  const tool = createDefaultToolRegistry().get("read_file_range");
  assert.ok(tool);

  const result = await tool.execute({ path: "example.ts", startLine: 2, endLine: 3 }, { cwd });

  assert.equal(result.ok, true);
  assert.deepEqual(result.output, {
    path: "example.ts",
    startLine: 2,
    endLine: 3,
    totalLines: 4,
    truncated: false,
    content: "two\nthree",
    lines: [
      { line: 2, text: "two" },
      { line: 3, text: "three" }
    ]
  });
});

test("read_file_range streams large files instead of loading them whole", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const content = Array.from({ length: 25_000 }, (_value, index) => `line-${index + 1} ${"x".repeat(8)}`).join("\n");
  await writeFile(path.join(cwd, "large.ts"), content, "utf8");
  const tool = createDefaultToolRegistry().get("read_file_range");
  assert.ok(tool);

  const result = await tool.execute({ path: "large.ts", startLine: 20_000, endLine: 20_001 }, { cwd });
  const output = result.output as {
    content: string;
    totalLines: number;
    streamed: boolean;
    lines: Array<{ line: number; text: string }>;
  };

  assert.equal(result.ok, true);
  assert.equal(output.streamed, true);
  assert.equal(output.totalLines, 25_000);
  assert.equal(output.content, "line-20000 xxxxxxxx\nline-20001 xxxxxxxx");
  assert.deepEqual(output.lines, [
    { line: 20_000, text: "line-20000 xxxxxxxx" },
    { line: 20_001, text: "line-20001 xxxxxxxx" }
  ]);
});

test("list_tree returns depth-limited entries and ignores generated directories", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await mkdir(path.join(cwd, "src", "feature"), { recursive: true });
  await mkdir(path.join(cwd, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(cwd, "src", "feature", "index.ts"), "export {};\n", "utf8");
  await writeFile(path.join(cwd, "src", "root.ts"), "export {};\n", "utf8");
  await writeFile(path.join(cwd, "node_modules", "pkg", "ignored.ts"), "ignored\n", "utf8");
  const tool = createDefaultToolRegistry().get("list_tree");
  assert.ok(tool);

  const result = await tool.execute({ path: ".", maxDepth: 3 }, { cwd });
  const output = result.output as { entries: Array<{ path: string; type: string; depth: number }> };

  assert.equal(result.ok, true);
  assert.equal(output.entries.some((entry) => entry.path === "src"), true);
  assert.equal(output.entries.some((entry) => entry.path === "src/feature/index.ts" && entry.depth === 3), true);
  assert.equal(output.entries.some((entry) => entry.path.includes("node_modules")), false);
});

test("list_code_definitions extracts top-level TypeScript and JavaScript symbols", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(
    path.join(cwd, "src", "defs.ts"),
    [
      "export interface User { id: string }",
      "export type UserId = string;",
      "export class UserStore {}",
      "export function loadUser() {",
      "  function nested() {}",
      "}",
      "const localHandler = () => true;",
      "export const exportedHandler = async () => true;"
    ].join("\n"),
    "utf8"
  );
  const tool = createDefaultToolRegistry().get("list_code_definitions");
  assert.ok(tool);

  const result = await tool.execute({ path: "src" }, { cwd });
  const output = result.output as { definitions: Array<{ name: string; kind: string; exported: boolean }> };

  assert.equal(result.ok, true);
  assert.deepEqual(output.definitions.map((definition) => definition.name), [
    "User",
    "UserId",
    "UserStore",
    "loadUser",
    "localHandler",
    "exportedHandler"
  ]);
  assert.deepEqual(output.definitions.map((definition) => definition.kind), [
    "interface",
    "type",
    "class",
    "function",
    "const",
    "const"
  ]);
  assert.equal(output.definitions.find((definition) => definition.name === "exportedHandler")?.exported, true);
  assert.equal(output.definitions.some((definition) => definition.name === "nested"), false);
});

test("find_references locates exact text and respects result limits", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.ts"), "target()\nother()\ntarget()\n", "utf8");
  await writeFile(path.join(cwd, "src", "b.ts"), "target()\n", "utf8");
  const tool = createDefaultToolRegistry().get("find_references");
  assert.ok(tool);

  const result = await tool.execute({ query: "target", path: "src", maxResults: 2 }, { cwd });
  const output = result.output as { matches: Array<{ path: string; line: number; column: number; text: string }>; truncated: boolean };

  assert.equal(result.ok, true);
  assert.equal(output.matches.length, 2);
  assert.equal(output.matches[0]?.path.endsWith(".ts"), true);
  assert.equal(output.matches[0]?.column, 1);
  assert.equal(output.truncated, true);
});

test("analyze_project_structure summarizes modules, tests, scripts, and dependencies", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await mkdir(path.join(cwd, "src", "cli"), { recursive: true });
  await mkdir(path.join(cwd, "test"), { recursive: true });
  await writeFile(path.join(cwd, "package-lock.json"), "", "utf8");
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      scripts: { test: "node --test" },
      dependencies: { react: "1.0.0" },
      devDependencies: { typescript: "1.0.0" },
      bin: { app: "src/index.ts" }
    }),
    "utf8"
  );
  await writeFile(path.join(cwd, "src", "index.ts"), "export {};\n", "utf8");
  await writeFile(path.join(cwd, "src", "cli", "app.tsx"), "export {};\n", "utf8");
  await writeFile(path.join(cwd, "test", "app.test.ts"), "test('ok', () => {});\n", "utf8");
  const tool = createDefaultToolRegistry().get("analyze_project_structure");
  assert.ok(tool);

  const result = await tool.execute({}, { cwd });
  const output = result.output as {
    packageManager: string;
    frameworks: string[];
    modules: Array<{ path: string; fileCount: number }>;
    tests: string[];
    scripts: Record<string, string>;
    dependencies: string[];
    devDependencies: string[];
  };

  assert.equal(result.ok, true);
  assert.equal(output.packageManager, "npm");
  assert.equal(output.frameworks.includes("Node CLI"), true);
  assert.equal(output.modules.some((module) => module.path === "src/cli"), true);
  assert.deepEqual(output.tests, ["test/app.test.ts"]);
  assert.deepEqual(output.scripts, { test: "node --test" });
  assert.deepEqual(output.dependencies, ["react"]);
  assert.deepEqual(output.devDependencies, ["typescript"]);
});

test("grep finds matches and returns no-match results", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.txt"), "alpha\nbeta\n", "utf8");
  await writeFile(path.join(cwd, "src", "b.txt"), "gamma\n", "utf8");
  const tool = createDefaultToolRegistry().get("grep");
  assert.ok(tool);

  const matchResult = await tool.execute({ query: "beta", path: "src" }, { cwd });
  const emptyResult = await tool.execute({ query: "delta", path: "src" }, { cwd });

  assert.equal(matchResult.ok, true);
  assert.deepEqual(matchResult.output, {
    matches: [{ path: "src/a.txt", line: 2, column: 1, text: "beta" }],
    truncated: false
  });
  assert.equal(emptyResult.ok, true);
  assert.deepEqual(emptyResult.output, { matches: [], truncated: false });
});

test("grep validates required query argument", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const tool = createDefaultToolRegistry().get("grep");
  assert.ok(tool);

  const result = await tool.execute({ path: "." }, { cwd });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("grep falls back to Node search and skips ignored directories when rg is unavailable", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await mkdir(path.join(cwd, ".git"), { recursive: true });
  await mkdir(path.join(cwd, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(cwd, "dist"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.txt"), "needle\n", "utf8");
  await writeFile(path.join(cwd, ".git", "hidden.txt"), "needle\n", "utf8");
  await writeFile(path.join(cwd, "node_modules", "pkg", "hidden.txt"), "needle\n", "utf8");
  await writeFile(path.join(cwd, "dist", "hidden.txt"), "needle\n", "utf8");
  const tool = createDefaultToolRegistry().get("grep");
  assert.ok(tool);
  const originalPath = process.env.PATH;

  try {
    process.env.PATH = "";
    const result = await tool.execute({ query: "needle", path: "." }, { cwd });

    assert.equal(result.ok, true);
    assert.deepEqual(result.output, {
      matches: [{ path: "src/a.txt", line: 1, column: 1, text: "needle" }],
      truncated: false
    });
  } finally {
    process.env.PATH = originalPath;
  }
});

test("write_file performs guarded workspace writes", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const tool = createDefaultToolRegistry().get("write_file");
  assert.ok(tool);

  const result = await tool.execute({ path: "generated/out.txt", content: "saved" }, { cwd });
  const written = await readFile(path.join(cwd, "generated", "out.txt"), "utf8");

  assert.equal(result.ok, true);
  assert.equal(written, "saved");
});

test("file_info reports metadata and optional file hash", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await writeFile(path.join(cwd, "info.txt"), "hello", "utf8");
  const tool = createDefaultToolRegistry().get("file_info");
  assert.ok(tool);

  const result = await tool.execute({ path: "info.txt", includeHash: true }, { cwd });
  const output = result.output as { path: string; type: string; size: number; modifiedAt: string; sha256: string };

  assert.equal(result.ok, true);
  assert.equal(output.path, "info.txt");
  assert.equal(output.type, "file");
  assert.equal(output.size, 5);
  assert.match(output.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(output.sha256.length, 64);
});

test("safer file operation tools create, copy, move, and soft-delete workspace paths", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await writeFile(path.join(cwd, "source.txt"), "content", "utf8");
  const registry = createDefaultToolRegistry();
  const createDirectory = registry.get("create_directory");
  const copyFile = registry.get("copy_file");
  const moveFile = registry.get("move_file");
  const deleteFile = registry.get("delete_file");
  assert.ok(createDirectory);
  assert.ok(copyFile);
  assert.ok(moveFile);
  assert.ok(deleteFile);

  const directory = await createDirectory.execute({ path: "nested" }, { cwd });
  const copied = await copyFile.execute({ source: "source.txt", destination: "nested/copied.txt" }, { cwd });
  const copiedContent = await readFile(path.join(cwd, "nested", "copied.txt"), "utf8");
  const moved = await moveFile.execute({ source: "nested/copied.txt", destination: "nested/moved.txt" }, { cwd });
  const movedContent = await readFile(path.join(cwd, "nested", "moved.txt"), "utf8");
  const deleted = await deleteFile.execute({ path: "nested/moved.txt" }, { cwd });
  const deleteOutput = deleted.output as { originalPath: string; trashPath: string; id: string };

  assert.equal(directory.ok, true);
  assert.equal(copied.ok, true);
  assert.equal(copiedContent, "content");
  assert.equal(moved.ok, true);
  assert.equal(movedContent, "content");
  assert.equal(deleted.ok, true);
  assert.equal(deleteOutput.originalPath, "nested/moved.txt");
  assert.match(deleteOutput.trashPath, /^\.workspace\/trash\/trash_/);
  assert.equal(await readFile(path.join(cwd, deleteOutput.trashPath), "utf8"), "content");
  assert.match(deleteOutput.id, /^trash_/);
});

test("copy_file and move_file reject overwrites unless explicitly allowed", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await writeFile(path.join(cwd, "source.txt"), "source", "utf8");
  await writeFile(path.join(cwd, "destination.txt"), "destination", "utf8");
  const registry = createDefaultToolRegistry();
  const copyFile = registry.get("copy_file");
  const moveFile = registry.get("move_file");
  assert.ok(copyFile);
  assert.ok(moveFile);

  const copyRejected = await copyFile.execute({ source: "source.txt", destination: "destination.txt" }, { cwd });
  const copyAllowed = await copyFile.execute({ source: "source.txt", destination: "destination.txt", overwrite: true }, { cwd });
  await writeFile(path.join(cwd, "move-source.txt"), "move", "utf8");
  const moveRejected = await moveFile.execute({ source: "move-source.txt", destination: "destination.txt" }, { cwd });

  assert.equal(copyRejected.ok, false);
  assert.equal(copyRejected.error?.code, "destination_exists");
  assert.equal(copyAllowed.ok, true);
  assert.equal(await readFile(path.join(cwd, "destination.txt"), "utf8"), "source");
  assert.equal(moveRejected.ok, false);
  assert.equal(moveRejected.error?.code, "destination_exists");
});

test("safer file operation tools reject paths outside the workspace and protected deletes", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const registry = createDefaultToolRegistry();
  const fileInfo = registry.get("file_info");
  const createDirectory = registry.get("create_directory");
  const copyFile = registry.get("copy_file");
  const deleteFile = registry.get("delete_file");
  assert.ok(fileInfo);
  assert.ok(createDirectory);
  assert.ok(copyFile);
  assert.ok(deleteFile);

  assert.equal((await fileInfo.execute({ path: "../outside" }, { cwd })).error?.code, "path_outside_workspace");
  assert.equal((await createDirectory.execute({ path: "../outside" }, { cwd })).error?.code, "path_outside_workspace");
  assert.equal((await copyFile.execute({ source: "missing.txt", destination: "../outside" }, { cwd })).error?.code, "path_outside_workspace");
  assert.equal((await deleteFile.execute({ path: "." }, { cwd })).error?.code, "protected_path");
});

test("detect_verification_commands returns package scripts in preferred order", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  await writeFile(path.join(cwd, "package-lock.json"), "", "utf8");
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      scripts: {
        build: "tsc -p tsconfig.json",
        test: "node --test",
        typecheck: "tsc --noEmit",
        lint: "eslint ."
      }
    }),
    "utf8"
  );
  const tool = createDefaultToolRegistry().get("detect_verification_commands");
  assert.ok(tool);

  const result = await tool.execute({}, { cwd });
  const output = result.output as { packageManager: string; commands: Array<{ name: string; command: string }> };

  assert.equal(result.ok, true);
  assert.equal(output.packageManager, "npm");
  assert.deepEqual(output.commands.map((command) => command.name), ["typecheck", "lint", "test", "build"]);
  assert.deepEqual(output.commands.map((command) => command.command), ["npm run typecheck", "npm run lint", "npm test", "npm run build"]);
});

test("verify_changes rejects risky commands and summarizes failed commands", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const tool = createDefaultToolRegistry().get("verify_changes");
  assert.ok(tool);

  const rejected = await tool.execute({ commands: ["npm publish"] }, { cwd });
  const failed = await tool.execute({ commands: ["node --test missing.test.js"] }, { cwd });

  assert.equal(rejected.ok, false);
  assert.equal(rejected.error?.code, "command_rejected");
  assert.equal(failed.ok, false);
  assert.equal(failed.error?.code, "verification_failed");
  assert.match(failed.error?.message ?? "", /node --test missing\.test\.js failed/);
  assert.equal((failed.metadata as { failedCommand?: string }).failedCommand, "node --test missing.test.js");
});

test("checkpoint tools create, list, and restore workspace snapshots", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-checkpoint-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "existing.ts"), "original\n", "utf8");
  await writeFile(path.join(cwd, "src", "delete-me.ts"), "keep\n", "utf8");
  assert.equal((await runFileCommand("git", ["init"], { cwd })).exitCode, 0);
  const registry = createDefaultToolRegistry();
  const createTool = registry.get("checkpoint_create");
  const listTool = registry.get("checkpoint_list");
  const restoreTool = registry.get("checkpoint_restore");
  assert.ok(createTool);
  assert.ok(listTool);
  assert.ok(restoreTool);

  const created = await createTool.execute({ name: "before edit" }, { cwd });
  await writeFile(path.join(cwd, "src", "existing.ts"), "changed\n", "utf8");
  await writeFile(path.join(cwd, "src", "new.ts"), "new\n", "utf8");
  await rmFile(path.join(cwd, "src", "delete-me.ts"));

  const listed = await listTool.execute({}, { cwd });
  const restored = await restoreTool.execute({ id: (created.output as { id: string }).id }, { cwd });

  assert.equal(created.ok, true);
  assert.equal((created.output as { fileCount: number }).fileCount, 2);
  assert.equal(listed.ok, true);
  assert.equal((listed.output as { checkpoints: unknown[] }).checkpoints.length, 1);
  assert.equal(restored.ok, true);
  assert.equal(await readFile(path.join(cwd, "src", "existing.ts"), "utf8"), "original\n");
  assert.equal(await readFile(path.join(cwd, "src", "delete-me.ts"), "utf8"), "keep\n");
  await assert.rejects(readFile(path.join(cwd, "src", "new.ts"), "utf8"));
  assert.deepEqual((restored.output as { removedFiles: string[] }).removedFiles, ["src/new.ts"]);
});

test("checkpoint_restore defaults to the latest checkpoint", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-checkpoint-"));
  await writeFile(path.join(cwd, "state.txt"), "one\n", "utf8");
  const registry = createDefaultToolRegistry();
  const createTool = registry.get("checkpoint_create");
  const restoreTool = registry.get("checkpoint_restore");
  assert.ok(createTool);
  assert.ok(restoreTool);

  await createTool.execute({ name: "one" }, { cwd });
  await writeFile(path.join(cwd, "state.txt"), "two\n", "utf8");
  const second = await createTool.execute({ name: "two" }, { cwd });
  await writeFile(path.join(cwd, "state.txt"), "three\n", "utf8");

  const restored = await restoreTool.execute({}, { cwd });

  assert.equal(restored.ok, true);
  assert.equal((restored.output as { id: string }).id, (second.output as { id: string }).id);
  assert.equal(await readFile(path.join(cwd, "state.txt"), "utf8"), "two\n");
});

test("filesystem tools reject paths outside the workspace", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));
  const tool = createDefaultToolRegistry().get("read_file");
  assert.ok(tool);

  const result = await tool.execute({ path: "../outside.txt" }, { cwd });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_outside_workspace");
});

test("resolveWorkspacePath handles root and rejects absolute paths outside the workspace", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-tools-"));

  assert.deepEqual(resolveWorkspacePath(cwd, "."), { ok: true, path: path.resolve(cwd) });
  assert.equal(resolveWorkspacePath(cwd, "../outside").ok, false);
  assert.equal(resolveWorkspacePath(cwd, path.join(os.tmpdir(), "outside.txt")).ok, false);
});

test("git_diff includes staged and unstaged diffs", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-git-"));
  assert.equal((await runFileCommand("git", ["init"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.email", "test@example.com"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.name", "Test User"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "staged.txt"), "base staged\n", "utf8");
  await writeFile(path.join(cwd, "unstaged.txt"), "base unstaged\n", "utf8");
  assert.equal((await runFileCommand("git", ["add", "."], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["commit", "-m", "initial"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "staged.txt"), "updated staged\n", "utf8");
  assert.equal((await runFileCommand("git", ["add", "staged.txt"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "unstaged.txt"), "updated unstaged\n", "utf8");

  const tool = createDefaultToolRegistry().get("git_diff");
  assert.ok(tool);
  const result = await tool.execute({}, { cwd });

  assert.equal(result.ok, true);
  const output = result.output as {
    stdout: string;
    unstaged: { stdout: string };
    staged: { stdout: string };
  };
  assert.match(output.stdout, /## unstaged/);
  assert.match(output.stdout, /## staged/);
  assert.match(output.unstaged.stdout, /updated unstaged/);
  assert.match(output.staged.stdout, /updated staged/);
});

test("expanded git tools report log, branches, show, file diff, and staging", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-git-"));
  assert.equal((await runFileCommand("git", ["init"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.email", "test@example.com"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.name", "Test User"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "tracked.txt"), "one\n", "utf8");
  assert.equal((await runFileCommand("git", ["add", "tracked.txt"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["commit", "-m", "initial"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "tracked.txt"), "two\n", "utf8");
  await writeFile(path.join(cwd, "new.txt"), "new\n", "utf8");
  const registry = createDefaultToolRegistry();
  const gitLog = registry.get("git_log");
  const gitBranch = registry.get("git_branch");
  const gitShow = registry.get("git_show");
  const gitDiffFile = registry.get("git_diff_file");
  const gitStage = registry.get("git_stage");
  assert.ok(gitLog);
  assert.ok(gitBranch);
  assert.ok(gitShow);
  assert.ok(gitDiffFile);
  assert.ok(gitStage);

  const log = await gitLog.execute({ maxCount: 1 }, { cwd });
  const branch = await gitBranch.execute({}, { cwd });
  const show = await gitShow.execute({ ref: "HEAD", path: "tracked.txt" }, { cwd });
  const diff = await gitDiffFile.execute({ path: "tracked.txt" }, { cwd });
  const staged = await gitStage.execute({ paths: ["new.txt"] }, { cwd });
  const status = await runFileCommand("git", ["status", "--short"], { cwd });

  assert.equal(log.ok, true);
  assert.equal((log.output as { commits: unknown[] }).commits.length, 1);
  assert.equal(branch.ok, true);
  assert.equal((branch.output as { branches: string[] }).branches.length >= 1, true);
  assert.equal(show.ok, true);
  assert.match((show.output as { stdout: string }).stdout, /one/);
  assert.equal(diff.ok, true);
  assert.match((diff.output as { stdout: string }).stdout, /two/);
  assert.equal(staged.ok, true);
  assert.deepEqual((staged.output as { stagedPaths: string[] }).stagedPaths, ["new.txt"]);
  assert.match(status.stdout, /A  new\.txt/);
});

test("git_restore unstages staged paths and restores worktree files with backup metadata", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-git-"));
  assert.equal((await runFileCommand("git", ["init"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.email", "test@example.com"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["config", "user.name", "Test User"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, ".gitignore"), ".workspace/\n", "utf8");
  await writeFile(path.join(cwd, "tracked.txt"), "base\n", "utf8");
  assert.equal((await runFileCommand("git", ["add", ".gitignore", "tracked.txt"], { cwd })).exitCode, 0);
  assert.equal((await runFileCommand("git", ["commit", "-m", "initial"], { cwd })).exitCode, 0);
  await writeFile(path.join(cwd, "tracked.txt"), "changed\n", "utf8");
  assert.equal((await runFileCommand("git", ["add", "tracked.txt"], { cwd })).exitCode, 0);
  const tool = createDefaultToolRegistry().get("git_restore");
  assert.ok(tool);

  const unstaged = await tool.execute({ paths: ["tracked.txt"], staged: true }, { cwd });
  const statusAfterUnstage = await runFileCommand("git", ["status", "--short"], { cwd });
  const restored = await tool.execute({ paths: ["tracked.txt"] }, { cwd });
  const statusAfterRestore = await runFileCommand("git", ["status", "--short"], { cwd });
  const restoreOutput = restored.output as { backup: { id: string; files: Array<{ path: string; existed: boolean; backupPath?: string }> } };

  assert.equal(unstaged.ok, true);
  assert.match(statusAfterUnstage.stdout, / M tracked\.txt/);
  assert.equal(restored.ok, true);
  assert.equal((await readFile(path.join(cwd, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n"), "base\n");
  assert.equal(statusAfterRestore.stdout.trim(), "");
  assert.match(restoreOutput.backup.id, /^git_restore_/);
  assert.equal(restoreOutput.backup.files[0]?.path, "tracked.txt");
  assert.equal(restoreOutput.backup.files[0]?.existed, true);
});

test("git_restore rejects unsafe paths", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-git-"));
  const tool = createDefaultToolRegistry().get("git_restore");
  assert.ok(tool);

  const result = await tool.execute({ paths: ["../outside.txt"] }, { cwd });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_outside_workspace");
});

async function rmFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
