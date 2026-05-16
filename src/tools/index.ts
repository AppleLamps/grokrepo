import { createCheckpointTools } from "./checkpoints.js";
import { createEditingTools } from "./editing.js";
import { createFileOperationTools } from "./file-ops.js";
import { createFilesystemTools } from "./filesystem.js";
import { createGitTools } from "./git.js";
import { createImageTools } from "./images.js";
import { createNavigationTools } from "./navigation.js";
import { ToolRegistry } from "./registry.js";
import { createSearchTools } from "./search.js";
import { createShellTools } from "./shell.js";
import { createVerificationTools } from "./verification.js";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of [
    ...createFilesystemTools(),
    ...createFileOperationTools(),
    ...createNavigationTools(),
    ...createGitTools(),
    ...createShellTools(),
    ...createVerificationTools(),
    ...createCheckpointTools(),
    ...createEditingTools(),
    ...createSearchTools(),
    ...createImageTools()
  ]) {
    registry.register(tool);
  }

  return registry;
}

export type { ToolRegistry } from "./registry.js";
export type {
  ParsedToolCallRequest,
  Tool,
  ToolCallRequest,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolPermission,
  ImageProviderLike,
  SearchProviderLike
} from "./types.js";
export { classifyShellCommand, type ShellRisk, type ShellRiskLevel } from "./shell-risk.js";
