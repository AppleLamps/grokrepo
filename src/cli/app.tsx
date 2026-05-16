import { Box, useApp, useInput } from "ink";
import { useMemo, useState } from "react";

import type { ContextBuilder } from "../context/index.js";
import { GrokProvider, type GrokUsage } from "../providers/grok.js";
import type { ImageProvider } from "../providers/images.js";
import type { SearchProvider } from "../providers/search.js";
import { runChatTurn, type ToolApprovalRequest, type ToolRuntimeEvent } from "../runtime/chat.js";
import type { Session, SessionMessage } from "../runtime/session.js";
import type { ContextRuntimeMetadata } from "../runtime/summarization.js";
import { captureClipboardImage } from "../tools/clipboard-image.js";
import type { ToolRegistry } from "../tools/index.js";
import type { ToolApprovalDecision } from "../tools/types.js";
import type { AppConfig } from "../utils/config.js";
import { readDebugLogTail, writeDebugLog, type DebugLogViewEntry } from "../utils/debug-log.js";
import { Header } from "./header.js";
import { ChatInput } from "./input.js";
import { ChatOutput, isExpandableSearchEvent } from "./output.js";
import { StatusBar } from "./status-bar.js";
import { getTheme } from "./theme.js";

interface AppProps {
  config: AppConfig;
  contextBuilder: ContextBuilder;
  provider: GrokProvider;
  imageProvider: ImageProvider;
  registry: ToolRegistry;
  searchProvider: SearchProvider;
  session: Session;
  sessionPath?: string;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (decision: ToolApprovalDecision) => void;
  selectedFiles: string[];
}

export function App({ config, contextBuilder, provider, imageProvider, registry, searchProvider, session, sessionPath }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<SessionMessage[]>([...session.listMessages()]);
  const [toolEvents, setToolEvents] = useState<ToolRuntimeEvent[]>([]);
  const [expandedToolEventIds, setExpandedToolEventIds] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [usage, setUsage] = useState<GrokUsage>();
  const [contextMetadata, setContextMetadata] = useState<ContextRuntimeMetadata>();
  const [lastSubmittedValue, setLastSubmittedValue] = useState<string>();
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugLogViewEntry[]>([]);
  const [helpVisible, setHelpVisible] = useState(false);
  const theme = useMemo(() => getTheme(config.uiTheme ?? "dark"), [config.uiTheme]);

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
      void writeDebugLog(process.cwd(), config.debug, "app.exit", { command: value });
      exit();
      return;
    }

    if (value === "/debug") {
      const entries = await readDebugLogTail(process.cwd(), 10);
      setDebugEntries(entries);
      setDebugVisible((current) => {
        const visible = !current;
        void writeDebugLog(process.cwd(), config.debug, "debug.toggle", { visible, entries: entries.length });
        return visible;
      });
      return;
    }

    if (value === "/help") {
      setHelpVisible((current) => {
        const visible = !current;
        void writeDebugLog(process.cwd(), config.debug, "help.toggle", { visible });
        return visible;
      });
      return;
    }

    if (value === "/clip" || value.startsWith("/clip ")) {
      await handleClipboardImage(value.slice("/clip".length).trim());
      return;
    }

    if (value === "/clipboard-image" || value.startsWith("/clipboard-image ")) {
      await handleClipboardImage(value.slice("/clipboard-image".length).trim());
      return;
    }

    if (value === "/retry") {
      if (!lastSubmittedValue) {
        setError("Nothing to retry yet.");
        void writeDebugLog(process.cwd(), config.debug, "chat.retry_missing");
        return;
      }

      await submitChat(lastSubmittedValue, { retry: true });
      return;
    }

    await submitChat(value, { retry: false });
  }

  async function handleClipboardImage(prompt: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    void writeDebugLog(process.cwd(), config.debug, "clipboard.capture_requested", { prompt });

    try {
      const result = await captureClipboardImage(process.cwd());

      if (!result.ok || !result.output) {
        setError(result.error?.message ?? "Clipboard image capture failed.");
        void writeDebugLog(process.cwd(), config.debug, "clipboard.capture_failed", { error: result.error });
        return;
      }

      void writeDebugLog(process.cwd(), config.debug, "clipboard.capture_complete", result.output);
      const nextPrompt = prompt.length > 0
        ? `${prompt}\n\nUse image_understand on ${result.output.path}.`
        : `Analyze the clipboard image saved at ${result.output.path}.`;

      await submitChat(nextPrompt, { retry: false });
    } finally {
      setBusy(false);
    }
  }

  async function submitChat(value: string, options: { retry: boolean }): Promise<void> {
    setBusy(true);
    setError(undefined);
    setUsage(undefined);
    setContextMetadata(undefined);
    setExpandedToolEventIds([]);
    setLastSubmittedValue(value);
    void writeDebugLog(process.cwd(), config.debug, options.retry ? "chat.retry" : "chat.submit", { value });

    session.addUserMessage(value);
    await persistSession();

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
        onSessionChange: () => persistSession(),
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
          setToolEvents((current) => mergeToolEvent(current, event));
          void writeDebugLog(process.cwd(), config.debug, "tool.event", {
            id: event.id,
            tool: event.tool,
            status: event.status,
            ok: event.result?.ok,
            error: event.result?.error?.code
          });
          if (debugVisible) {
            void refreshDebugEntries();
          }
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
      void writeDebugLog(process.cwd(), config.debug, "chat.complete", {
        usage: result.usage,
        context: result.context
      });
      if (debugVisible) {
        void refreshDebugEntries();
      }
    } catch (cause) {
      setMessages([...session.listMessages()]);
      await persistSession();
      const message = cause instanceof Error ? cause.message : "Unknown chat error.";
      setError(message);
      void writeDebugLog(process.cwd(), config.debug, "chat.error", { message });
      if (debugVisible) {
        void refreshDebugEntries();
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshDebugEntries(): Promise<void> {
    setDebugEntries(await readDebugLogTail(process.cwd(), 10));
  }

  async function persistSession(): Promise<void> {
    if (!sessionPath) {
      return;
    }

    try {
      await session.save(sessionPath);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Session save failed.";
      setError(`Session save failed: ${message}`);
      void writeDebugLog(process.cwd(), config.debug, "session.save_failed", { message });
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header status={status} busy={busy} cwd={process.cwd()} theme={theme} debug={Boolean(config.debug)} />
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
          debugEntries={debugEntries}
          debugVisible={debugVisible}
          helpVisible={helpVisible}
          busy={busy}
          debug={Boolean(config.debug)}
          theme={theme}
        />
      </Box>
      <Box marginTop={1}>
        <ChatInput disabled={busy || Boolean(pendingApproval)} onSubmit={(value) => void handleSubmit(value)} theme={theme} />
      </Box>
      <StatusBar
        busy={busy}
        error={error}
        usage={usage}
        contextMetadata={contextMetadata}
        debug={Boolean(config.debug)}
        providerStatus={status}
        cwd={process.cwd()}
        theme={theme}
      />
    </Box>
  );
}

export function mergeToolEvent(events: readonly ToolRuntimeEvent[], next: ToolRuntimeEvent): ToolRuntimeEvent[] {
  const index = events.findIndex((event) => event.id === next.id);

  if (index < 0) {
    return [...events, next];
  }

  return [
    ...events.slice(0, index),
    next,
    ...events.slice(index + 1)
  ];
}
