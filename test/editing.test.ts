import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyPatch, undoPatch } from "../src/editing/engine.js";
import { generateUnifiedDiff, parseUnifiedDiff } from "../src/editing/diff.js";

test("parseUnifiedDiff parses changed files", () => {
  const patch = generateUnifiedDiff("a.txt", "one\n", "two\n");
  const parsed = parseUnifiedDiff(patch);

  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0]?.path, "a.txt");
  assert.equal(parsed.files[0]?.kind, "modify");
});

test("applyPatch applies a single-file patch", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");

  const result = await applyPatch(
    { patch: generateUnifiedDiff("a.txt", "one\n", "two\n"), summary: "change one line" },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt"] } }
  );

  assert.equal(result.ok, true);
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "two\n");
});

test("applyPatch applies a multi-file patch", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");
  await writeFile(path.join(cwd, "b.txt"), "red\n", "utf8");

  const patch = [
    generateUnifiedDiff("a.txt", "one\n", "two\n"),
    generateUnifiedDiff("b.txt", "red\n", "blue\n")
  ].join("\n");

  const result = await applyPatch(
    { patch },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt", "b.txt"] } }
  );

  assert.equal(result.ok, true);
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "two\n");
  assert.equal(await readFile(path.join(cwd, "b.txt"), "utf8"), "blue\n");
});

test("applyPatch supports file-level partial apply", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");
  await writeFile(path.join(cwd, "b.txt"), "red\n", "utf8");

  const patch = [
    generateUnifiedDiff("a.txt", "one\n", "two\n"),
    generateUnifiedDiff("b.txt", "red\n", "blue\n")
  ].join("\n");

  const result = await applyPatch(
    { patch },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt"] } }
  );

  assert.equal(result.ok, true);
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "two\n");
  assert.equal(await readFile(path.join(cwd, "b.txt"), "utf8"), "red\n");
  assert.match(JSON.stringify(result.output), /b\.txt/);
});

test("applyPatch rejects invalid patches", async () => {
  const cwd = await createTempWorkspace();
  const result = await applyPatch({ patch: "not a patch" }, { cwd, approval: { approved: true } });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_patch");
});

test("applyPatch rejects path traversal", async () => {
  const cwd = await createTempWorkspace();
  const patch = generateUnifiedDiff("../outside.txt", "one\n", "two\n");
  const result = await applyPatch(
    { patch },
    { cwd, approval: { approved: true, approvedFiles: ["../outside.txt"] } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_outside_workspace");
});

test("applyPatch rejects stale patches", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "actual\n", "utf8");

  const result = await applyPatch(
    { patch: generateUnifiedDiff("a.txt", "expected\n", "updated\n") },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt"] } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "apply_failed");
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "actual\n");
});

test("applyPatch creates backup artifacts", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");

  const result = await applyPatch(
    { patch: generateUnifiedDiff("a.txt", "one\n", "two\n") },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt"] } }
  );

  assert.equal(result.ok, true);
  const backupId = readBackupId(result.output);
  const manifestPath = path.join(cwd, ".workspace", "patches", "backups", backupId, "manifest.json");
  const manifestStat = await stat(manifestPath);

  assert.equal(manifestStat.isFile(), true);
});

test("applyPatch rolls back already-applied files when a later file fails", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");
  await writeFile(path.join(cwd, "b.txt"), "actual\n", "utf8");

  const patch = [
    generateUnifiedDiff("a.txt", "one\n", "two\n"),
    generateUnifiedDiff("b.txt", "expected\n", "updated\n")
  ].join("\n");

  const result = await applyPatch(
    { patch },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt", "b.txt"] } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "apply_failed");
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "one\n");
  assert.equal(await readFile(path.join(cwd, "b.txt"), "utf8"), "actual\n");
});

test("undoPatch restores a completed patch", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");

  const applyResult = await applyPatch(
    { patch: generateUnifiedDiff("a.txt", "one\n", "two\n") },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt"] } }
  );

  assert.equal(applyResult.ok, true);
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "two\n");

  const undoResult = await undoPatch({ backupId: readBackupId(applyResult.output) }, { cwd, approval: { approved: true } });

  assert.equal(undoResult.ok, true);
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "one\n");
});

async function createTempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "grokcode-editing-"));
}

function readBackupId(output: unknown): string {
  assert.equal(typeof output, "object");
  assert.notEqual(output, null);

  const backupId = (output as { backupId?: unknown }).backupId;
  assert.equal(typeof backupId, "string");
  return backupId;
}
