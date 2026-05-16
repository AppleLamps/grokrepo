import type { ChatCompletionTool } from "openai/resources/chat/completions";

export type ToolPermission = "passive" | "active";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  items?: JsonSchema;
  enum?: string[];
  default?: JsonValue;
  additionalProperties?: boolean;
}

export interface ToolExecutionContext {
  cwd: string;
  approval?: ToolApprovalDecision;
  searchProvider?: SearchProviderLike;
  imageProvider?: ImageProviderLike;
  signal?: AbortSignal;
}

export interface SearchProviderLike {
  runWebSearch(args: unknown): Promise<ToolExecutionResult>;
  runXSearch(args: unknown): Promise<ToolExecutionResult>;
}

export interface ImageProviderLike {
  generateImage(args: unknown): Promise<ToolExecutionResult>;
  editImage(args: unknown): Promise<ToolExecutionResult>;
  understandImage(args: unknown): Promise<ToolExecutionResult>;
}

export interface ToolApprovalDecision {
  approved: boolean;
  approvedFiles?: string[];
  strongConfirmation?: boolean;
}

export interface ToolExecutionError {
  code: string;
  message: string;
}

export interface ToolExecutionResult<TOutput = unknown> {
  ok: boolean;
  tool: string;
  output?: TOutput;
  error?: ToolExecutionError;
  metadata?: Record<string, unknown>;
}

export interface Tool<TArgs = unknown, TOutput = unknown> {
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: JsonSchema;
  execute(args: TArgs, context: ToolExecutionContext): Promise<ToolExecutionResult<TOutput>>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface ParsedToolCallRequest extends ToolCallRequest {
  parsedArguments: unknown;
}

export function toChatCompletionTool(tool: Tool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  } as unknown as ChatCompletionTool;
}

export function toolSuccess<TOutput>(
  tool: string,
  output: TOutput,
  metadata?: Record<string, unknown>
): ToolExecutionResult<TOutput> {
  return {
    ok: true,
    tool,
    output,
    ...(metadata ? { metadata } : {})
  };
}

export function toolFailure(
  tool: string,
  code: string,
  message: string,
  metadata?: Record<string, unknown>
): ToolExecutionResult {
  return {
    ok: false,
    tool,
    error: {
      code,
      message
    },
    ...(metadata ? { metadata } : {})
  };
}
