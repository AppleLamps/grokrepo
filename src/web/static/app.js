const elements = {
  providerStatus: document.querySelector("#providerStatus"),
  planMode: document.querySelector("#planMode"),
  actMode: document.querySelector("#actMode"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  slashMenu: document.querySelector("#slashMenu"),
  retry: document.querySelector("#retry"),
  stop: document.querySelector("#stop"),
  send: document.querySelector("#send"),
  approval: document.querySelector("#approval"),
  status: document.querySelector("#status")
};

const slashCommands = [
  { name: "/help", description: "Show available commands", run: () => openSlashMenu(true) },
  { name: "/plan", description: "Switch to planning mode", run: () => postJson("/api/mode", { mode: "plan" }) },
  { name: "/act", description: "Switch to action mode", run: () => postJson("/api/mode", { mode: "act" }) },
  { name: "/retry", description: "Retry the last prompt", run: () => postJson("/api/retry", {}) },
  { name: "/stop", description: "Stop the current turn", run: () => postJson("/api/stop", {}) },
  { name: "/debug", description: "Show current runtime state", run: () => showLocalStatus(debugState()) }
];

let state = undefined;
let streamedAssistant = "";
let slashMenuOpen = false;
let slashMenuIndex = 0;
let forceAllCommands = false;
const toolEvents = new Map();

await refreshState();
connectEvents();

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitComposer();
});

elements.prompt.addEventListener("input", () => {
  updateSlashMenu();
});

elements.prompt.addEventListener("keydown", (event) => {
  if (slashMenuOpen && handleSlashMenuKeydown(event)) {
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitComposer();
  }
});

elements.retry.addEventListener("click", () => {
  streamedAssistant = "";
  void postJson("/api/retry", {});
});

elements.stop.addEventListener("click", () => {
  void postJson("/api/stop", {});
});

elements.planMode.addEventListener("click", () => {
  void postJson("/api/mode", { mode: "plan" });
});

elements.actMode.addEventListener("click", () => {
  void postJson("/api/mode", { mode: "act" });
});

document.addEventListener("click", (event) => {
  if (!elements.composer.contains(event.target)) {
    closeSlashMenu();
  }
});

function connectEvents() {
  const events = new EventSource("/api/events");

  events.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    render();
  });

  events.addEventListener("assistant_delta", (event) => {
    const payload = JSON.parse(event.data);
    streamedAssistant += payload.delta ?? "";
    renderTranscript();
  });

  events.addEventListener("tool_event", (event) => {
    const payload = JSON.parse(event.data);
    toolEvents.set(payload.id, payload);
    renderTranscript();
  });

  events.addEventListener("approval_requested", (event) => {
    const approval = JSON.parse(event.data);
    state = {
      ...state,
      pendingApproval: approval
    };
    renderApproval();
    renderStatus();
  });

  events.addEventListener("turn_complete", () => {
    streamedAssistant = "";
  });

  events.addEventListener("error", (event) => {
    const payload = JSON.parse(event.data);
    showLocalStatus(payload.message ?? "Web UI error.");
  });
}

async function refreshState() {
  const response = await fetch("/api/state");
  state = await response.json();
  for (const event of state.toolEvents ?? []) {
    toolEvents.set(event.id, event);
  }
  render();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    showLocalStatus(payload.error ?? response.statusText);
    return undefined;
  }

  return response.json().catch(() => undefined);
}

function render() {
  renderHeader();
  renderTranscript();
  renderApproval();
  renderStatus();
}

function renderHeader() {
  elements.providerStatus.textContent = state.providerStatus ?? "";
  elements.planMode.classList.toggle("active", state.taskMode === "plan");
  elements.actMode.classList.toggle("active", state.taskMode === "act");
  elements.planMode.disabled = Boolean(state.busy);
  elements.actMode.disabled = Boolean(state.busy);
}

function renderTranscript() {
  const entries = buildTranscriptEntries();
  elements.messages.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty transcript-empty";
    empty.textContent = "No messages yet.";
    elements.messages.append(empty);
    return;
  }

  for (const entry of entries) {
    elements.messages.append(renderTranscriptEntry(entry));
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function buildTranscriptEntries() {
  const entries = [];
  const messages = [...(state.messages ?? [])];
  const renderedToolIds = new Set();
  const toolMessages = new Map();

  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) {
      toolMessages.set(message.toolCallId, message);
    }
  }

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool") {
      if (!message.toolCallId || renderedToolIds.has(message.toolCallId)) {
        continue;
      }

      entries.push({
        type: "tool",
        id: message.toolCallId,
        event: toolEvents.get(message.toolCallId),
        resultMessage: message
      });
      renderedToolIds.add(message.toolCallId);
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      if ((message.content ?? "").trim()) {
        entries.push({ type: "message", message });
      }

      for (const call of message.toolCalls) {
        entries.push({
          type: "tool",
          id: call.id,
          call,
          event: toolEvents.get(call.id),
          resultMessage: toolMessages.get(call.id)
        });
        renderedToolIds.add(call.id);
      }
      continue;
    }

    entries.push({ type: "message", message });
  }

  for (const event of toolEvents.values()) {
    if (!renderedToolIds.has(event.id)) {
      entries.push({ type: "tool", id: event.id, event });
    }
  }

  if (streamedAssistant) {
    entries.push({
      type: "message",
      message: {
        id: "streaming",
        role: "assistant",
        content: streamedAssistant
      }
    });
  }

  return entries;
}

function renderTranscriptEntry(entry) {
  if (entry.type === "tool") {
    return renderToolCard(entry);
  }

  return renderMessage(entry.message);
}

function renderMessage(message) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  node.innerHTML = `<div class="message-role"></div><div class="message-content markdown-body"></div>`;
  node.querySelector(".message-role").textContent = message.role === "assistant" ? "Grok" : message.role;
  node.querySelector(".message-content").innerHTML = renderMarkdown(message.content ?? "");
  return node;
}

function renderToolCard(entry) {
  const tool = toolCardData(entry);
  const node = document.createElement("article");
  node.className = `tool-card ${tool.status}`;
  node.innerHTML = `
    <button class="tool-summary" type="button" aria-expanded="false">
      <span class="tool-name"></span>
      <span class="tool-status"></span>
    </button>
    <div class="tool-details" hidden>
      <pre></pre>
    </div>
  `;

  node.querySelector(".tool-name").textContent = tool.name;
  node.querySelector(".tool-status").textContent = tool.statusLabel;
  node.querySelector("pre").textContent = tool.detail;

  const summary = node.querySelector(".tool-summary");
  const details = node.querySelector(".tool-details");
  summary.addEventListener("click", () => {
    const expanded = summary.getAttribute("aria-expanded") === "true";
    summary.setAttribute("aria-expanded", String(!expanded));
    details.hidden = expanded;
  });

  return node;
}

function toolCardData(entry) {
  const parsedResult = parseToolResult(entry.resultMessage?.content);
  const event = entry.event;
  const call = entry.call;
  const name = event?.tool ?? parsedResult?.tool ?? call?.name ?? "tool";
  const status = event?.status ?? (parsedResult ? "completed" : "requested");
  const statusLabel = toolStatusLabel(status, parsedResult, event);

  if (event?.result) {
    return {
      name,
      status,
      statusLabel,
      detail: compactToolResult(event.result)
    };
  }

  if (parsedResult) {
    return {
      name,
      status,
      statusLabel,
      detail: compactToolResult(parsedResult)
    };
  }

  return {
    name,
    status,
    statusLabel,
    detail: JSON.stringify(event?.args ?? parseToolArguments(call?.arguments), null, 2)
  };
}

function toolStatusLabel(status, result, event) {
  if (result?.ok) {
    return "done";
  }

  if (result?.error) {
    return result.error.code ?? "failed";
  }

  if (event?.result?.ok) {
    return "done";
  }

  if (event?.result?.error) {
    return event.result.error.code ?? "failed";
  }

  return status.replaceAll("_", " ");
}

function compactToolResult(result) {
  if (result.ok) {
    return JSON.stringify(result.output ?? {}, null, 2);
  }

  if (result.error) {
    return `${result.error.code}: ${result.error.message}`;
  }

  return JSON.stringify(result, null, 2);
}

function parseToolResult(content) {
  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function parseToolArguments(raw) {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function renderMarkdown(source) {
  const parts = source.split(/```([\w-]*)\n?([\s\S]*?)```/g);
  let html = "";

  for (let index = 0; index < parts.length; index += 3) {
    html += renderMarkdownText(parts[index] ?? "");
    if (index + 2 < parts.length) {
      const language = parts[index + 1]?.trim();
      const code = parts[index + 2] ?? "";
      html += `<pre class="code-block"><code${language ? ` data-language="${escapeAttribute(language)}"` : ""}>${escapeHtml(code)}</code></pre>`;
    }
  }

  return html;
}

function renderMarkdownText(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) {
      return;
    }

    const tag = list.ordered ? "ol" : "ul";
    blocks.push(`<${tag}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    list = undefined;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 1;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      if (!list || list.ordered !== orderedList) {
        flushList();
        list = { ordered: orderedList, items: [] };
      }
      list.items.push((unordered ?? ordered)[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.join("");
}

function renderInlineMarkdown(source) {
  const tokens = [];
  let escaped = escapeHtml(source).replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@CODE${tokens.length}@@`;
    tokens.push(`<code>${code}</code>`);
    return token;
  });

  escaped = escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, url) => {
      const safeUrl = escapeAttribute(url);
      return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");

  for (let index = 0; index < tokens.length; index += 1) {
    escaped = escaped.replace(`@@CODE${index}@@`, tokens[index]);
  }

  return escaped;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function renderApproval() {
  const approval = state.pendingApproval;
  if (!approval) {
    elements.approval.className = "approval empty";
    elements.approval.textContent = "No approval pending.";
    return;
  }

  elements.approval.className = "approval";
  elements.approval.innerHTML = `
    <strong></strong>
    <pre></pre>
    <div class="file-list"></div>
    <div class="approval-actions"></div>
  `;
  elements.approval.querySelector("strong").textContent = approval.tool;
  elements.approval.querySelector("pre").textContent = approval.diff || approval.preview;

  const fileList = elements.approval.querySelector(".file-list");
  for (const file of approval.files ?? []) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" checked> <span></span>`;
    label.querySelector("span").textContent = file;
    label.querySelector("input").dataset.file = file;
    fileList.append(label);
  }

  const actions = elements.approval.querySelector(".approval-actions");
  if (approval.kind === "patch") {
    actions.append(actionButton("Apply Selected", () => approvePatch(approval, selectedFiles())));
    actions.append(actionButton("Apply All", () => approvePatch(approval, approval.files ?? [])));
    actions.append(actionButton("Skip", () => approvePatch(approval, [])));
    actions.append(actionButton("Deny", () => denyApproval(approval)));
    return;
  }

  actions.append(actionButton("Approve", () => approveStandard(approval, false)));
  if (approval.risk?.requiresStrongConfirmation) {
    actions.append(actionButton("Strong Approve", () => approveStandard(approval, true)));
  }
  actions.append(actionButton("Deny", () => denyApproval(approval)));
}

function actionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function selectedFiles() {
  return [...elements.approval.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.dataset.file)
    .filter(Boolean);
}

function approvePatch(approval, approvedFiles) {
  void postJson("/api/approval", {
    id: approval.id,
    approved: true,
    approvedFiles
  });
}

function approveStandard(approval, strongConfirmation) {
  void postJson("/api/approval", {
    id: approval.id,
    approved: true,
    strongConfirmation
  });
}

function denyApproval(approval) {
  void postJson("/api/approval", {
    id: approval.id,
    approved: false
  });
}

function submitComposer() {
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    return;
  }

  if (prompt.startsWith("/")) {
    executeSlashCommand(prompt);
    return;
  }

  streamedAssistant = "";
  elements.prompt.value = "";
  closeSlashMenu();
  void postJson("/api/chat", { prompt });
}

function updateSlashMenu() {
  forceAllCommands = false;
  const value = elements.prompt.value;
  if (!value.startsWith("/")) {
    closeSlashMenu();
    return;
  }

  openSlashMenu(false);
}

function openSlashMenu(showAll) {
  forceAllCommands = showAll;
  const commands = filteredSlashCommands();
  slashMenuOpen = commands.length > 0;
  slashMenuIndex = Math.min(slashMenuIndex, Math.max(commands.length - 1, 0));
  renderSlashMenu(commands);
}

function closeSlashMenu() {
  slashMenuOpen = false;
  forceAllCommands = false;
  elements.slashMenu.hidden = true;
  elements.slashMenu.innerHTML = "";
}

function filteredSlashCommands() {
  const query = forceAllCommands ? "/" : elements.prompt.value.trim().toLowerCase();
  if (!query.startsWith("/")) {
    return [];
  }

  return slashCommands.filter((command) => command.name.startsWith(query));
}

function renderSlashMenu(commands = filteredSlashCommands()) {
  if (commands.length === 0) {
    closeSlashMenu();
    return;
  }

  elements.slashMenu.hidden = false;
  elements.slashMenu.innerHTML = "";

  commands.forEach((command, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slash-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === slashMenuIndex));
    button.innerHTML = `<span class="slash-name"></span><span class="slash-description"></span>`;
    button.querySelector(".slash-name").textContent = command.name;
    button.querySelector(".slash-description").textContent = command.description;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => runSlashCommand(command));
    elements.slashMenu.append(button);
  });
}

function handleSlashMenuKeydown(event) {
  const commands = filteredSlashCommands();
  if (commands.length === 0) {
    return false;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    slashMenuIndex = (slashMenuIndex + 1) % commands.length;
    renderSlashMenu(commands);
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    slashMenuIndex = (slashMenuIndex - 1 + commands.length) % commands.length;
    renderSlashMenu(commands);
    return true;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    elements.prompt.value = commands[slashMenuIndex].name;
    openSlashMenu(true);
    return true;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    runSlashCommand(commands[slashMenuIndex]);
    return true;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeSlashMenu();
    return true;
  }

  return false;
}

function executeSlashCommand(prompt) {
  const [name] = prompt.split(/\s+/, 1);
  const command = slashCommands.find((entry) => entry.name === name);
  if (!command) {
    showLocalStatus(`Unknown command: ${name}`);
    openSlashMenu(true);
    return;
  }

  runSlashCommand(command);
}

function runSlashCommand(command) {
  elements.prompt.value = "";
  closeSlashMenu();
  const result = command.run();
  void result;
}

function debugState() {
  const tools = [...toolEvents.values()].length;
  const messages = state.messages?.filter((message) => message.role !== "system").length ?? 0;
  return [
    `mode: ${state.taskMode}`,
    `busy: ${Boolean(state.busy)}`,
    `messages: ${messages}`,
    `tool events: ${tools}`,
    `cwd: ${state.cwd}`
  ].join(" | ");
}

function showLocalStatus(message) {
  elements.status.textContent = message;
}

function renderStatus() {
  elements.send.disabled = Boolean(state.busy || state.pendingApproval);
  elements.retry.disabled = Boolean(state.busy || state.pendingApproval);
  elements.stop.disabled = !state.busy;
  const verification = state.verification?.state ? `verification: ${state.verification.state}` : "verification: not_run";
  elements.status.textContent = [
    state.busy ? "Running" : "Idle",
    state.taskMode,
    verification,
    state.cwd
  ].filter(Boolean).join(" | ");
}
