export type ShellRiskLevel = "safe" | "mutating" | "destructive" | "network" | "publish";

export interface ShellRisk {
  level: ShellRiskLevel;
  reason: string;
  requiresStrongConfirmation: boolean;
}

const SAFE_PREFIXES = [
  "cat",
  "date",
  "dir",
  "echo",
  "find",
  "git diff",
  "git log",
  "git show",
  "git status",
  "ls",
  "pwd",
  "rg",
  "sed",
  "type",
  "wc",
  "which"
];

const VERIFICATION_PREFIXES = [
  "npm run build",
  "npm run lint",
  "npm run test",
  "npm run typecheck",
  "npm test",
  "node --test",
  "pnpm build",
  "pnpm lint",
  "pnpm test",
  "pnpm typecheck",
  "yarn build",
  "yarn lint",
  "yarn test",
  "yarn typecheck"
];

export function classifyShellCommand(command: string): ShellRisk {
  const normalized = normalizeCommand(command);

  if (!normalized) {
    return risk("safe", "Empty shell command.");
  }

  if (matchesAny(normalized, [
    /\bnpm\s+publish\b/,
    /\bpnpm\s+publish\b/,
    /\byarn\s+npm\s+publish\b/,
    /\bgit\s+push\b/,
    /\b(?:deploy|release)\b/
  ])) {
    return risk("publish", "Publishes, deploys, releases, or pushes artifacts/branches.");
  }

  if (matchesAny(normalized, [
    /\brm\s+(-[^\s]*r[^\s]*f|-([^\s]*f[^\s]*r|[^\s]*r[^\s]*f))\b/,
    /\bgit\s+reset\b.*\s--hard\b/,
    /\bgit\s+clean\b/,
    /\bdel\s+\/[qsf]/,
    /\brmdir\s+\/s\b/,
    /\bmkfs\b/,
    /\bchmod\s+-r\b/,
    />\s*\/dev\/sd[a-z]/
  ])) {
    return risk("destructive", "Deletes, force-cleans, resets, or may overwrite important data.");
  }

  if (matchesAny(normalized, [
    /\bcurl\b.*\|\s*(?:sh|bash|zsh|pwsh|powershell)\b/,
    /\bwget\b.*\|\s*(?:sh|bash|zsh|pwsh|powershell)\b/,
    /\bnpm\s+(?:install|i|add)\b/,
    /\bpnpm\s+(?:install|add)\b/,
    /\byarn\s+(?:install|add)\b/,
    /\bbun\s+(?:install|add)\b/,
    /\bcurl\b/,
    /\bwget\b/,
    /\bssh\b/,
    /\bscp\b/,
    /\brsync\b/
  ])) {
    return risk("network", "Downloads, uploads, installs packages, or calls a remote service.");
  }

  if (matchesAny(normalized, [
    /\bgit\s+(?:commit|add|restore|checkout|switch|merge|rebase|stash|tag)\b/,
    /\b(?:touch|mkdir|cp|mv)\b/,
    /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:format|fix|codegen|generate|prepack|prepare)\b/,
    /\b(?:tsc|eslint|prettier)\b.*\s--(?:write|fix)\b/,
    />|>>/
  ])) {
    return risk("mutating", "Writes local files or changes repository state.");
  }

  if (startsWithAny(normalized, SAFE_PREFIXES) || startsWithAny(normalized, VERIFICATION_PREFIXES)) {
    return risk("safe", "Read-only inspection or verification command.");
  }

  return risk("mutating", "Unknown shell command; treating as potentially state-changing.");
}

function risk(level: ShellRiskLevel, reason: string): ShellRisk {
  return {
    level,
    reason,
    requiresStrongConfirmation: level === "destructive" || level === "publish"
  };
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

function startsWithAny(command: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => command === prefix || command.startsWith(`${prefix} `));
}

function matchesAny(command: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(command));
}
