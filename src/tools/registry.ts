import type { ChatCompletionTool } from "openai/resources/chat/completions";

import { toChatCompletionTool, type Tool } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): readonly Tool[] {
    return [...this.tools.values()];
  }

  toChatCompletionTools(options: { includeActive?: boolean } = {}): ChatCompletionTool[] {
    const includeActive = options.includeActive ?? true;
    return this.list()
      .filter((tool) => includeActive || tool.permission !== "active")
      .map((tool) => toChatCompletionTool(tool));
  }
}
