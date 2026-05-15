import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyPatch, createPatchPreview, undoPatch } from "../src/editing/engine.js";
import { applyPatchToContent, generateUnifiedDiff, parseUnifiedDiff } from "../src/editing/diff.js";

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

test("applyPatch with no selected files returns skipped files without backup", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");

  const result = await applyPatch(
    { patch: generateUnifiedDiff("a.txt", "one\n", "two\n"), summary: "skip change" },
    { cwd, approval: { approved: true, approvedFiles: [] } }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.output, {
    appliedFiles: [],
    skippedFiles: ["a.txt"],
    backupId: null,
    summary: "skip change"
  });
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "one\n");
});

test("applyPatch reports missing file targets", async () => {
  const cwd = await createTempWorkspace();

  const result = await applyPatch(
    { patch: generateUnifiedDiff("missing.txt", "one\n", "two\n") },
    { cwd, approval: { approved: true, approvedFiles: ["missing.txt"] } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "missing_file");
});

test("applyPatch rejects binary file targets", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "bin.dat"), Buffer.from([0, 1, 2, 3]));

  const result = await applyPatch(
    { patch: generateUnifiedDiff("bin.dat", "one\n", "two\n") },
    { cwd, approval: { approved: true, approvedFiles: ["bin.dat"] } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "binary_file");
});

test("applyPatch creates a file from a /dev/null patch", async () => {
  const cwd = await createTempWorkspace();
  const patch = [
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1,2 @@",
    "+hello",
    "+world"
  ].join("\n");

  const result = await applyPatch(
    { patch },
    { cwd, approval: { approved: true, approvedFiles: ["new.txt"] } }
  );

  assert.equal(result.ok, true);
  assert.equal(await readFile(path.join(cwd, "new.txt"), "utf8"), "hello\nworld\n");
});

test("applyPatch rejects invalid patches", async () => {
  const cwd = await createTempWorkspace();
  const result = await applyPatch({ patch: "not a patch" }, { cwd, approval: { approved: true } });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_patch");
});

test("createPatchPreview returns files, summary, and diff for valid patches", () => {
  const patch = generateUnifiedDiff("a.txt", "one\n", "two\n");

  assert.deepEqual(createPatchPreview({ patch, summary: "change a" }), {
    files: ["a.txt"],
    summary: "change a",
    diff: patch
  });
  assert.equal(createPatchPreview({ patch: "not a patch" }), undefined);
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

test("undoPatch without backupId restores the latest patch", async () => {
  const cwd = await createTempWorkspace();
  await writeFile(path.join(cwd, "a.txt"), "one\n", "utf8");

  const applyResult = await applyPatch(
    { patch: generateUnifiedDiff("a.txt", "one\n", "two\n") },
    { cwd, approval: { approved: true, approvedFiles: ["a.txt"] } }
  );

  assert.equal(applyResult.ok, true);
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "two\n");

  const undoResult = await undoPatch({}, { cwd, approval: { approved: true } });

  assert.equal(undoResult.ok, true);
  assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "one\n");
});

test("applyPatchToContent throws on stale hunks", () => {
  const file = parseUnifiedDiff(generateUnifiedDiff("a.txt", "expected\n", "updated\n")).files[0];
  assert.ok(file);

  assert.throws(() => applyPatchToContent(file, "actual\n"), /Stale patch/);
});

test("applyPatchToContent supports multiple hunks in one file", () => {
  const patch = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "@@ -5,3 +5,3 @@",
    " five",
    "-six",
    "+SIX",
    " seven"
  ].join("\n");
  const file = parseUnifiedDiff(patch).files[0];
  assert.ok(file);

  const updated = applyPatchToContent(file, "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");

  assert.equal(updated, "one\nTWO\nthree\nfour\nfive\nSIX\nseven\n");
});

test("applyPatchToContent normalizes CRLF input", () => {
  const file = parseUnifiedDiff(generateUnifiedDiff("a.txt", "one\n", "two\n")).files[0];
  assert.ok(file);

  assert.equal(applyPatchToContent(file, "one\r\n"), "two\n");
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
