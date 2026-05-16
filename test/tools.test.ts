import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDefaultToolRegistry } from "../src/tools/index.js";
import { resolveWorkspacePath } from "../src/tools/path.js";
import { runFileCommand } from "../src/tools/process.js";
import { ToolRegistry } from "../src/tools/registry.js";

test("default registry exposes Phase 2 tools with expected permissions", () => {
  const registry = createDefaultToolRegistry();

  assert.equal(registry.get("read_file")?.permission, "passive");
  assert.equal(registry.get("list_files")?.permission, "passive");
  assert.equal(registry.get("grep")?.permission, "passive");
  assert.equal(registry.get("git_status")?.permission, "passive");
  assert.equal(registry.get("git_diff")?.permission, "passive");
  assert.equal(registry.get("write_file")?.permission, "active");
  assert.equal(registry.get("run_shell")?.permission, "active");
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
