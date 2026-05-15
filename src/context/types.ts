export interface RepoScanResult {
  cwd: string;
  packageManager?: string;
  frameworks: string[];
  entrypoints: string[];
  keyFiles: string[];
  git: {
    isRepo: boolean;
    branch?: string;
    status: string[];
    recentFiles: string[];
  };
}

export type ContextItemKind = "metadata" | "file" | "git";

export interface ContextItem {
  kind: ContextItemKind;
  title: string;
  content: string;
  priority: number;
  estimatedTokens: number;
  path?: string;
}

export interface BuiltContext {
  prompt: string;
  items: ContextItem[];
  estimatedTokens: number;
  truncated: boolean;
}

export interface ContextOptions {
  tokenBudget: number;
  maxFileBytes: number;
  maxFiles: number;
  ignoredDirectories: string[];
}

export interface ContextBuilder {
  buildContext(cwd: string, latestUserMessage: string): Promise<BuiltContext>;
}
