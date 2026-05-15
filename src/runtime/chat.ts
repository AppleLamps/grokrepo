import type { GrokProvider, GrokUsage } from "../providers/grok.js";
import type { Session } from "./session.js";
import type { ContextBuilder } from "../context/index.js";
import type { BuiltContext } from "../context/types.js";
import { createPatchPreview } from "../editing/engine.js";
import {
  type ContextRuntimeMetadata,
  type ConversationSummarizer,
  type SummarizationOptions,
  summarizeSessionIfNeeded
} from "./summarization.js";
import { parseToolArguments } from "../tools/args.js";
import type {
  ParsedToolCallRequest,
  Tool,
  ToolCallRequest,
  ToolExecutionResult,
  ToolRegistry,
  ImageProviderLike,
  SearchProviderLike
} from "../tools/index.js";
import { toolFailure, type ToolApprovalDecision } from "../tools/types.js";

export interface ChatTurnResult {
  content: string;
  usage?: GrokUsage;
  context?: ContextRuntimeMetadata;
}

export type ToolEventStatus = "requested" | "approval_requested" | "approved" | "denied" | "running" | "completed";

export interface ToolRuntimeEvent {
  id: string;
  tool: string;
  permission?: "passive" | "active";
  status: ToolEventStatus;
  args?: unknown;
  result?: ToolExecutionResult;
}

export interface ToolApprovalRequest {
  call: ParsedToolCallRequest;
  tool: Tool;
  preview: string;
  kind: "standard" | "patch";
  files?: string[];
  diff?: string;
  summary?: string;
}

export interface RunChatTurnOptions {
  session: Session;
  provider: Pick<GrokProvider, "streamChat"> & Partial<ConversationSummarizer>;
  registry: ToolRegistry;
  cwd: string;
  onDelta: (delta: string) => void;
  onToolEvent?: (event: ToolRuntimeEvent) => void;
  requestApproval: (request: ToolApprovalRequest) => Promise<boolean | ToolApprovalDecision>;
  contextBuilder?: ContextBuilder;
  imageProvider?: ImageProviderLike;
  searchProvider?: SearchProviderLike;
  maxToolRounds?: number;
  summarization?: Partial<SummarizationOptions>;
}

export async function runChatTurn(options: RunChatTurnOptions): Promise<ChatTurnResult> {
  const maxToolRounds = options.maxToolRounds ?? 6;
  let usage: GrokUsage | undefined;
  const turnContext = await buildTurnContext(options);
  const summaryMetadata = await summarizeSessionIfNeeded(
    options.session,
    options.provider.summarizeConversation ? options.provider as ConversationSummarizer : undefined,
    options.summarization
  );
  const contextMetadata: ContextRuntimeMetadata = {
    ...(turnContext
      ? {
          repoContext: {
            estimatedTokens: turnContext.estimatedTokens,
            truncated: turnContext.truncated,
            itemCount: turnContext.items.length
          }
        }
      : {}),
    conversationSummary: summaryMetadata
  };

  for (let round = 0; round < maxToolRounds; round += 1) {
    let content = "";
    let toolCalls: ToolCallRequest[] = [];

    for await (const event of options.provider.streamChat(
      options.session.toChatMessages(turnContext?.prompt),
      options.registry.toChatCompletionTools()
    )) {
      if (event.type === "content" && event.content) {
        content += event.content;
        options.onDelta(event.content);
      }

      if (event.type === "usage") {
        usage = event.usage;
      }

      if (event.type === "tool_calls" && event.toolCalls) {
        toolCalls = [...toolCalls, ...event.toolCalls];
      }
    }

    if (toolCalls.length === 0) {
      options.session.addAssistantMessage(content);
      return {
        content,
        usage,
        context: contextMetadata
      };
    }

    options.session.addAssistantMessage(content, toolCalls);

    for (const toolCall of toolCalls) {
      const result = await executeToolCall(toolCall, options);
      options.session.addToolMessage(toolCall.id, JSON.stringify(result));
    }
  }

  const content = "Stopped after reaching the tool round limit.";
  options.onDelta(content);
  options.session.addAssistantMessage(content);

  return {
    content,
    usage,
    context: contextMetadata
  };
}

async function buildTurnContext(options: RunChatTurnOptions): Promise<BuiltContext | undefined> {
  if (!options.contextBuilder) {
    return undefined;
  }

  const latestUserMessage = [...options.session.listMessages()]
    .reverse()
    .find((message) => message.role === "user")
    ?.content;

  if (!latestUserMessage) {
    return undefined;
  }

  const context = await options.contextBuilder.buildContext(options.cwd, latestUserMessage);
  return context;
}

async function executeToolCall(
  call: ToolCallRequest,
  options: RunChatTurnOptions
): Promise<ToolExecutionResult> {
  const parsed = parseToolArguments(call.arguments);

  if (!parsed.ok) {
    const result = toolFailure(call.name, "invalid_arguments", parsed.message);
    options.onToolEvent?.({
      id: call.id,
      tool: call.name,
      status: "completed",
      result
    });
    return result;
  }

  const parsedCall: ParsedToolCallRequest = {
    ...call,
    parsedArguments: parsed.value
  };

  const tool = options.registry.get(call.name);

  if (!tool) {
    const result = toolFailure(call.name, "unknown_tool", `Unknown tool: ${call.name}`);
    options.onToolEvent?.({
      id: call.id,
      tool: call.name,
      status: "completed",
      args: parsed.value,
      result
    });
    return result;
  }

  options.onToolEvent?.({
    id: call.id,
    tool: tool.name,
    permission: tool.permission,
    status: "requested",
    args: parsed.value
  });

  let approval: ToolApprovalDecision | undefined;

  if (tool.permission === "active") {
    options.onToolEvent?.({
      id: call.id,
      tool: tool.name,
      permission: tool.permission,
      status: "approval_requested",
      args: parsed.value
    });

    approval = normalizeApprovalDecision(
      await options.requestApproval(createApprovalRequest(parsedCall, tool, parsed.value))
    );

    if (!approval.approved) {
      const result = toolFailure(tool.name, "approval_denied", "User denied tool execution.");
      options.onToolEvent?.({
        id: call.id,
        tool: tool.name,
        permission: tool.permission,
        status: "denied",
        args: parsed.value,
        result
      });
      return result;
    }

    options.onToolEvent?.({
      id: call.id,
      tool: tool.name,
      permission: tool.permission,
      status: "approved",
      args: parsed.value
    });
  }

  options.onToolEvent?.({
    id: call.id,
    tool: tool.name,
    permission: tool.permission,
    status: "running",
    args: parsed.value
  });

  const result = await tool.execute(parsed.value, {
    cwd: options.cwd,
    approval,
    imageProvider: options.imageProvider,
    searchProvider: options.searchProvider
  });

  options.onToolEvent?.({
    id: call.id,
    tool: tool.name,
    permission: tool.permission,
    status: "completed",
    args: parsed.value,
    result
  });

  return result;
}

function createApprovalRequest(call: ParsedToolCallRequest, tool: Tool, args: unknown): ToolApprovalRequest {
  if (tool.name === "apply_patch") {
    const patchPreview = createPatchPreview(args);

    if (patchPreview) {
      return {
        call,
        tool,
        kind: "patch",
        preview: patchPreview.summary ?? `Patch changes ${patchPreview.files.length} file(s).`,
        files: patchPreview.files,
        diff: patchPreview.diff,
        summary: patchPreview.summary
      };
    }
  }

  return {
    call,
    tool,
    kind: "standard",
    preview: createApprovalPreview(tool.name, args)
  };
}

function createApprovalPreview(toolName: string, args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return toolName;
  }

  const record = args as Record<string, unknown>;

  if (toolName === "run_shell" && typeof record.command === "string") {
    return record.command;
  }

  if (toolName === "write_file" && typeof record.path === "string") {
    const content = typeof record.content === "string" ? record.content : "";
    return `${record.path} (${Buffer.byteLength(content, "utf8")} bytes)`;
  }

  if (toolName === "git_commit" && typeof record.message === "string") {
    return record.message;
  }

  if (toolName === "image_generate" && typeof record.prompt === "string") {
    const count = typeof record.count === "number" ? record.count : 1;
    const details = [
      `${count} image${count === 1 ? "" : "s"}`,
      typeof record.aspectRatio === "string" ? record.aspectRatio : undefined,
      typeof record.resolution === "string" ? record.resolution : undefined
    ].filter(Boolean);

    return `${record.prompt}\n${details.join(", ")} -> .workspace/images`;
  }

  if (toolName === "image_edit" && typeof record.prompt === "string") {
    const images = Array.isArray(record.images) ? record.images.length : 0;
    const details = [
      `${images} source image${images === 1 ? "" : "s"}`,
      typeof record.aspectRatio === "string" ? record.aspectRatio : undefined,
      typeof record.resolution === "string" ? record.resolution : undefined
    ].filter(Boolean);

    return `${record.prompt}\n${details.join(", ")} -> .workspace/images`;
  }

  if (toolName === "capture_clipboard_image") {
    return "Capture the current Windows clipboard image and save it under .workspace/images.";
  }

  return JSON.stringify(args);
}

function normalizeApprovalDecision(decision: boolean | ToolApprovalDecision): ToolApprovalDecision {
  if (typeof decision === "boolean") {
    return {
      approved: decision
    };
  }

  return decision;
}
