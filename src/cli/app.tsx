import { Box, Text, useApp, useInput } from "ink";
import { useMemo, useState } from "react";

import type { ContextBuilder } from "../context/index.js";
import { GrokProvider, type GrokUsage } from "../providers/grok.js";
import type { ImageProvider } from "../providers/images.js";
import type { SearchProvider } from "../providers/search.js";
import { runChatTurn, type ToolApprovalRequest, type ToolRuntimeEvent } from "../runtime/chat.js";
import type { Session, SessionMessage } from "../runtime/session.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import type { ToolRegistry } from "../tools/index.js";
import type { ToolApprovalDecision } from "../tools/types.js";
import type { AppConfig } from "../utils/config.js";
import { ChatInput } from "./input.js";
import { ChatOutput, isExpandableSearchEvent } from "./output.js";

interface AppProps {
  config: AppConfig;
  contextBuilder: ContextBuilder;
  provider: GrokProvider;
  imageProvider: ImageProvider;
  registry: ToolRegistry;
  searchProvider: SearchProvider;
  session: Session;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (decision: ToolApprovalDecision) => void;
  selectedFiles: string[];
}

export function App({ config, contextBuilder, provider, imageProvider, registry, searchProvider, session }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<SessionMessage[]>([...session.listMessages()]);
  const [toolEvents, setToolEvents] = useState<ToolRuntimeEvent[]>([]);
  const [expandedToolEventIds, setExpandedToolEventIds] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [usage, setUsage] = useState<GrokUsage>();
  const [contextMetadata, setContextMetadata] = useState<ContextRuntimeMetadata>();

  const status = useMemo(() => {
    if (config.mock) {
      return "mock mode";
    }

    return provider.canCallApi()
      ? `${config.model} via ${config.baseUrl} using ${config.apiKeySource ?? "API key"}`
      : "missing XAI_API_KEY";
  }, [config.apiKeySource, config.baseUrl, config.mock, config.model, provider]);

  useInput((input, key) => {
    if (!pendingApproval) {
      if (key.tab) {
        const latestSearchEvent = [...toolEvents].reverse().find(isExpandableSearchEvent);

        if (latestSearchEvent) {
          setExpandedToolEventIds((current) =>
            current.includes(latestSearchEvent.id)
              ? current.filter((id) => id !== latestSearchEvent.id)
              : [...current, latestSearchEvent.id]
          );
        }
      }

      return;
    }

    const normalized = input.toLowerCase();
    const files = pendingApproval.request.files ?? [];

    if (pendingApproval.request.kind === "patch") {
      if (normalized === "a") {
        pendingApproval.resolve({ approved: true, approvedFiles: files });
        setPendingApproval(undefined);
        return;
      }

      if (normalized === "s") {
        pendingApproval.resolve({ approved: true, approvedFiles: [] });
        setPendingApproval(undefined);
        return;
      }

      if (key.return || normalized === "y") {
        pendingApproval.resolve({ approved: true, approvedFiles: pendingApproval.selectedFiles });
        setPendingApproval(undefined);
        return;
      }

      if (/^[1-9]$/.test(normalized)) {
        const index = Number(normalized) - 1;
        const file = files[index];

        if (file) {
          setPendingApproval((current) => {
            if (!current) {
              return current;
            }

            const selected = new Set(current.selectedFiles);

            if (selected.has(file)) {
              selected.delete(file);
            } else {
              selected.add(file);
            }

            return {
              ...current,
              selectedFiles: [...selected]
            };
          });
        }

        return;
      }
    }

    if (normalized === "y") {
      pendingApproval.resolve({ approved: true });
      setPendingApproval(undefined);
    }

    if (normalized === "n") {
      pendingApproval.resolve({ approved: false });
      setPendingApproval(undefined);
    }
  });

  async function handleSubmit(value: string): Promise<void> {
    if (value === "/exit" || value === "/quit") {
      exit();
      return;
    }

    setBusy(true);
    setError(undefined);
    setUsage(undefined);
    setContextMetadata(undefined);
    setExpandedToolEventIds([]);

    session.addUserMessage(value);

    const assistantId = `stream_${Date.now().toString(36)}`;
    const startedAt = new Date().toISOString();

    setMessages([
      ...session.listMessages(),
      { id: assistantId, role: "assistant", content: "", createdAt: startedAt }
    ]);

    try {
      const result = await runChatTurn({
        session,
        provider,
        contextBuilder,
        imageProvider,
        registry,
        searchProvider,
        cwd: process.cwd(),
        onDelta: (delta) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: `${message.content}${delta}`
                  }
                : message
            )
          );
        },
        onToolEvent: (event) => {
          setToolEvents((current) => [...current, event]);
        },
        requestApproval: (request) =>
          new Promise((resolve) => {
            setPendingApproval({
              request,
              resolve,
              selectedFiles: request.files ?? []
            });
          })
      });

      setMessages([...session.listMessages()]);
      setUsage(result.usage);
      setContextMetadata(result.context);
    } catch (cause) {
      setMessages([...session.listMessages()]);
      setError(cause instanceof Error ? cause.message : "Unknown chat error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">GrokCode</Text>
      <Text color="gray">Phase 6 context runtime, {status}. Type /exit to quit.</Text>
      <Box marginTop={1} flexDirection="column">
        <ChatOutput
          messages={messages}
          toolEvents={toolEvents}
          pendingApproval={pendingApproval?.request}
          selectedApprovalFiles={pendingApproval?.selectedFiles}
          expandedToolEventIds={expandedToolEventIds}
          error={error}
          usage={usage}
          contextMetadata={contextMetadata}
        />
      </Box>
      <Box marginTop={1}>
        <ChatInput disabled={busy || Boolean(pendingApproval)} onSubmit={(value) => void handleSubmit(value)} />
      </Box>
    </Box>
  );
}
