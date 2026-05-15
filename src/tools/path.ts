import path from "node:path";

export function resolveWorkspacePath(cwd: string, requestedPath: string): { ok: true; path: string } | { ok: false; error: string } {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, requestedPath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      error: `Path is outside the workspace: ${requestedPath}`
    };
  }

  return {
    ok: true,
    path: resolved
  };
}

export function toWorkspaceRelativePath(cwd: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(cwd), absolutePath);
  return relative.length > 0 ? relative.replaceAll(path.sep, "/") : ".";
}
