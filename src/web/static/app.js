const elements = {
  providerStatus: document.querySelector("#providerStatus"),
  planMode: document.querySelector("#planMode"),
  actMode: document.querySelector("#actMode"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  retry: document.querySelector("#retry"),
  stop: document.querySelector("#stop"),
  send: document.querySelector("#send"),
  approval: document.querySelector("#approval"),
  tools: document.querySelector("#tools"),
  status: document.querySelector("#status")
};

let state = undefined;
let streamedAssistant = "";
const toolEvents = new Map();

await refreshState();
connectEvents();

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    return;
  }

  streamedAssistant = "";
  elements.prompt.value = "";
  void postJson("/api/chat", { prompt });
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

function connectEvents() {
  const events = new EventSource("/api/events");

  events.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    render();
  });

  events.addEventListener("assistant_delta", (event) => {
    const payload = JSON.parse(event.data);
    streamedAssistant += payload.delta ?? "";
    renderMessages();
  });

  events.addEventListener("tool_event", (event) => {
    const payload = JSON.parse(event.data);
    toolEvents.set(payload.id, payload);
    renderTools();
  });

  events.addEventListener("approval_requested", (event) => {
    const approval = JSON.parse(event.data);
    state = {
      ...state,
      pendingApproval: approval
    };
    renderApproval();
  });

  events.addEventListener("turn_complete", () => {
    streamedAssistant = "";
  });

  events.addEventListener("error", (event) => {
    const payload = JSON.parse(event.data);
    elements.status.textContent = payload.message ?? "Web UI error.";
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
    elements.status.textContent = payload.error ?? response.statusText;
    return undefined;
  }

  return response.json().catch(() => undefined);
}

function render() {
  renderHeader();
  renderMessages();
  renderTools();
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

function renderMessages() {
  const messages = [...(state.messages ?? [])];
  if (streamedAssistant) {
    messages.push({
      id: "streaming",
      role: "assistant",
      content: streamedAssistant
    });
  }

  elements.messages.innerHTML = "";
  for (const message of messages.filter((entry) => entry.role !== "system")) {
    const node = document.createElement("article");
    node.className = `message ${message.role}`;
    node.innerHTML = `<div class="message-role"></div><div class="message-content"></div>`;
    node.querySelector(".message-role").textContent = message.role;
    node.querySelector(".message-content").textContent = formatMessageContent(message);
    elements.messages.append(node);
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function formatMessageContent(message) {
  if (message.role !== "tool") {
    return message.content ?? "";
  }

  try {
    const parsed = JSON.parse(message.content);
    return parsed.ok
      ? `${parsed.tool}: ok`
      : `${parsed.tool}: ${parsed.error?.code ?? "failed"} ${parsed.error?.message ?? ""}`;
  } catch {
    return message.content ?? "";
  }
}

function renderTools() {
  const events = [...toolEvents.values()];
  if (events.length === 0) {
    elements.tools.className = "tools empty";
    elements.tools.textContent = "No tool activity yet.";
    return;
  }

  elements.tools.className = "tools";
  elements.tools.innerHTML = "";
  for (const event of events) {
    const node = document.createElement("div");
    node.className = "tool";
    node.innerHTML = `
      <div class="tool-title">
        <strong></strong>
        <span></span>
      </div>
      <pre></pre>
    `;
    node.querySelector("strong").textContent = event.tool;
    node.querySelector("span").textContent = event.status;
    node.querySelector("pre").textContent = compactToolEvent(event);
    elements.tools.append(node);
  }
}

function compactToolEvent(event) {
  if (event.result?.ok) {
    return JSON.stringify(event.result.output ?? {}, null, 2);
  }

  if (event.result?.error) {
    return `${event.result.error.code}: ${event.result.error.message}`;
  }

  return JSON.stringify(event.args ?? {}, null, 2);
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
