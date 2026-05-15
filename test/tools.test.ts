import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDefaultToolRegistry } from "../src/tools/index.js";
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
