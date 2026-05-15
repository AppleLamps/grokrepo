import { createEditingTools } from "./editing.js";
import { createFilesystemTools } from "./filesystem.js";
import { createGitTools } from "./git.js";
import { createImageTools } from "./images.js";
import { ToolRegistry } from "./registry.js";
import { createSearchTools } from "./search.js";
import { createShellTools } from "./shell.js";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of [
    ...createFilesystemTools(),
    ...createGitTools(),
    ...createShellTools(),
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
