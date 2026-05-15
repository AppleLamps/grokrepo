import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { budgetContext, DefaultContextBuilder, extractFileReferences, scanRepo } from "../src/context/index.js";
import type { ContextItem } from "../src/context/types.js";

test("scanRepo detects package manager, frameworks, and entrypoints", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-context-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "package-lock.json"), "{}");
  await writeFile(path.join(cwd, "src", "index.ts"), "export {};\n");
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      type: "module",
      bin: { grokcode: "./dist/index.js" },
      dependencies: { ink: "1.0.0", react: "1.0.0" },
      devDependencies: { typescript: "1.0.0" }
    })
  );
  await writeFile(path.join(cwd, "tsconfig.json"), "{}");

  const scan = await scanRepo(cwd);

  assert.equal(scan.packageManager, "npm");
  assert.deepEqual(scan.frameworks, ["Ink", "Node CLI", "React", "TypeScript"]);
  assert.equal(scan.entrypoints.includes("src/index.ts"), true);
  assert.equal(scan.entrypoints.includes("./dist/index.js"), true);
});

test("extractFileReferences parses quoted, inline, and plain paths", () => {
  assert.deepEqual(extractFileReferences("read `src/index.ts`, \"package.json\", and src/cli/app.tsx"), [
    "src/index.ts",
    "package.json",
    "src/cli/app.tsx"
  ]);
});

test("DefaultContextBuilder prioritizes explicit file references", async () => {
  const cwd = await createContextWorkspace();
  const builder = new DefaultContextBuilder({ tokenBudget: 2_000, maxFiles: 4 });

  const context = await builder.buildContext(cwd, "explain src/special.ts");

  assert.equal(context.items.some((item) => item.title === "Explicit File: src/special.ts"), true);
  assert.equal(context.items.find((item) => item.path === "src/special.ts")?.priority, 110);
});

test("DefaultContextBuilder ignores configured directories", async () => {
  const cwd = await createContextWorkspace();
  await mkdir(path.join(cwd, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(cwd, "node_modules", "pkg", "index.ts"), "ignored");
  const builder = new DefaultContextBuilder({ tokenBudget: 4_000, maxFiles: 20 });

  const context = await builder.buildContext(cwd, "explain node_modules/pkg/index.ts");

  assert.equal(context.items.some((item) => item.path?.includes("node_modules")), false);
});

test("budgetContext trims lower-priority items first", () => {
  const items: ContextItem[] = [
    createItem("low", "low content ".repeat(400), 10),
    createItem("high", "high content", 100)
  ];

  const context = budgetContext(items, 80);

  assert.equal(context.truncated, true);
  assert.equal(context.items.some((item) => item.title === "high"), true);
  assert.equal(context.items.some((item) => item.title === "low"), false);
});

test("DefaultContextBuilder truncates large file excerpts", async () => {
  const cwd = await createContextWorkspace();
  await writeFile(path.join(cwd, "src", "large.ts"), "x".repeat(500));
  const builder = new DefaultContextBuilder({ tokenBudget: 2_000, maxFileBytes: 100, maxFiles: 4 });

  const context = await builder.buildContext(cwd, "read src/large.ts");
  const item = context.items.find((entry) => entry.path === "src/large.ts");

  assert.ok(item);
  assert.match(item.content, /\[truncated\]/);
});

test("scanRepo returns non-repo git metadata outside git", async () => {
  const cwd = await createContextWorkspace();

  const scan = await scanRepo(cwd);

  assert.equal(scan.git.isRepo, false);
  assert.deepEqual(scan.git.status, []);
  assert.deepEqual(scan.git.recentFiles, []);
});

async function createContextWorkspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-context-"));
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "package-lock.json"), "{}");
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { ink: "1.0.0", react: "1.0.0" } }));
  await writeFile(path.join(cwd, "tsconfig.json"), "{}");
  await writeFile(path.join(cwd, "README.md"), "# Example\n");
  await writeFile(path.join(cwd, "src", "index.ts"), "export const entry = true;\n");
  await writeFile(path.join(cwd, "src", "special.ts"), "export const special = true;\n");

  return cwd;
}

function createItem(title: string, content: string, priority: number): ContextItem {
  return {
    kind: "file",
    title,
    content,
    priority,
    estimatedTokens: Math.ceil(content.length / 4)
  };
}
