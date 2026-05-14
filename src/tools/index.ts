import { createEditingTools } from "./editing.js";
import { createFilesystemTools } from "./filesystem.js";
import { createGitTools } from "./git.js";
import { ToolRegistry } from "./registry.js";
import { createShellTools } from "./shell.js";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of [...createFilesystemTools(), ...createGitTools(), ...createShellTools(), ...createEditingTools()]) {
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
  ToolPermission
} from "./types.js";
