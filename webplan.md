# GrokCode Web UI Plan

## Goal

Add an optional local web UI without replacing the existing Ink terminal UI.

Target command shape:

```bash
grokcode --web
grokcode --web --port 4141
```

The first version should run only on localhost, reuse the current runtime, preserve the approval model for active tools, and avoid turning the package into a large frontend stack too early.

## Repo Review Summary

The best integration point is `runChatTurn` in `src/runtime/chat.ts`. It already accepts callbacks for streamed assistant deltas, tool lifecycle events, session persistence, and active-tool approval. That means the web UI does not need a separate agent runtime.

Relevant existing pieces:

- `src/index.ts`: current CLI entrypoint and mode switch location.
- `src/runtime/headless.ts`: existing argument parser for one-shot mode; likely place to extend or split CLI parsing.
- `src/runtime/chat.ts`: shared chat runtime to reuse from both Ink and web.
- `src/runtime/session.ts` and `src/runtime/session-store.ts`: session state and `.workspace/sessions/current.json` persistence.
- `src/cli/app.tsx`: current reference implementation for commands, approvals, task mode, checkpoint commands, clipboard image capture, and UI state.
- `src/tools/*`: tool registry and active/passive tool permissions already work independently of Ink.
- `package.json`: package currently ships only `dist`, `README.md`, `.env.example`, and `tools.md`; any web static assets must be emitted under `dist` or added to `files`.

Recommended first architecture:

- Node built-in HTTP server for the backend.
- Static HTML/CSS/JS served from the compiled package.
- Server-Sent Events for chat streaming.
- JSON POST endpoints for user actions and approvals.
- No Vite/React dependency for the first cut.

This keeps the web option small and compatible with the package’s current low-dependency design. A richer bundled React app can come later if the UI needs complex component state.

## Phase 1: CLI Mode Parsing

1. Introduce a shared launch argument parser.
   - Add `src/runtime/launch-args.ts`.
   - Move or wrap the existing `parseHeadlessArgs` behavior so it can also recognize web mode.
   - Keep current behavior unchanged:
     - no args starts Ink UI
     - prompt args start headless mode
     - `--print`, `--json`, and `--yes-safe` continue to work

2. Add web options.
   - `--web`: start web server instead of Ink.
   - `--port <number>`: choose port, default `4141`.
   - `--host <host>`: default `127.0.0.1`.
   - Reject unsafe defaults such as binding to `0.0.0.0` unless a future explicit `--allow-lan` option is added.

3. Update `src/index.ts`.
   - Build the same shared dependencies once:
     - `config`
     - `provider`
     - `imageProvider`
     - `searchProvider`
     - `contextBuilder`
     - `session`
     - `registry`
   - Branch into:
     - headless runner
     - web server runner
     - Ink UI renderer

4. Tests.
   - Add parser coverage in `test/runtime.test.ts` or a new `test/launch-args.test.ts`.
   - Confirm existing headless parsing is unchanged.
   - Confirm `--web`, `--web --port 4142`, invalid ports, and unknown options behave predictably.

## Phase 2: Web Server Skeleton

1. Add `src/web/server.ts`.
   - Export `startWebServer(options): Promise<WebServerHandle>`.
   - Use `node:http`, not Express, for the first implementation.
   - Return a handle with:
     - `url`
     - `close(): Promise<void>`

2. Add static asset serving.
   - Add source assets under `src/web/static/`:
     - `index.html`
     - `app.js`
     - `styles.css`
   - Because TypeScript will not copy static files automatically, add a small script or build step later in Phase 6.
   - During development, server can load from `src/web/static` when running via `tsx`, and from `dist/web/static` after build.

3. Add basic endpoints.
   - `GET /`: serve `index.html`.
   - `GET /app.js`: serve JS with `Content-Type: text/javascript`.
   - `GET /styles.css`: serve CSS.
   - `GET /api/state`: return current session messages, task mode, provider status, cwd, and busy state.
   - `POST /api/mode`: set task mode to `plan` or `act`.
   - `POST /api/stop`: reserve for a later cancellation feature; initially return `501` or omit.

4. Security baseline.
   - Bind to `127.0.0.1` by default.
   - Reject non-POST mutations.
   - Check `Origin` for POST requests when present and only allow the local server origin.
   - Do not expose `.env`, `.workspace`, or arbitrary file reads over HTTP. File access must still go through model tools and approvals.

5. Tests.
   - Add `test/web.test.ts`.
   - Test static responses, `/api/state`, unsupported routes, and server close.
   - Use Node’s built-in `fetch` in tests.

## Phase 3: Chat Streaming Protocol

1. Add a per-server state object.
   - Track:
     - `busy`
     - `messages`
     - `toolEvents`
     - `pendingApproval`
     - `lastSubmittedPrompt`
     - `usage`
     - `contextMetadata`
     - `verificationStatus`
     - connected SSE clients

2. Add endpoints.
   - `GET /api/events`: Server-Sent Events stream.
   - `POST /api/chat`: submit a prompt.
   - `POST /api/retry`: rerun the last submitted prompt.

3. Implement `/api/chat`.
   - Reject with `409` if a chat turn is already running.
   - Add the user message through `session.addUserMessage(prompt)`.
   - Run `runChatTurn` with:
     - `onDelta`: publish `{ type: "assistant_delta", delta }`
     - `onToolEvent`: publish `{ type: "tool_event", event }`
     - `onSessionChange`: save session and publish `{ type: "state", state }`
     - `requestApproval`: create a pending approval promise and publish `{ type: "approval_requested", approval }`
   - On completion, publish `{ type: "turn_complete", result }`.
   - On error, publish `{ type: "error", message }` and clear `busy`.

4. Preserve session behavior.
   - Use the same `.workspace/sessions/current.json` path as the CLI.
   - Save after every session change, matching `src/cli/app.tsx`.

5. Tests.
   - Use a mock provider that emits content and tool calls.
   - Verify SSE receives deltas and completion.
   - Verify `POST /api/chat` rejects while busy.
   - Verify session is persisted after a turn.

## Phase 4: Approval Flow

1. Model pending approvals for web.
   - Store one pending approval at a time:
     - approval id
     - `ToolApprovalRequest`
     - resolver function
     - selected patch files
   - The approval id can be the tool call id.

2. Add endpoints.
   - `POST /api/approval`.
   - Body shape:

```json
{
  "id": "tool_call_id",
  "approved": true,
  "strongConfirmation": false,
  "approvedFiles": ["src/file.ts"]
}
```

3. Approval rules.
   - Standard active tools:
     - approve
     - deny
     - require `strongConfirmation` for destructive/publish shell risks
   - Patch tools:
     - approve selected files
     - approve all files
     - skip all files
     - deny
   - Match the behavior in `src/cli/app.tsx`.

4. Frontend approval UI.
   - Show tool name, risk, preview, and diff when available.
   - For patch approvals, render file checkboxes and actions:
     - Apply Selected
     - Apply All
     - Skip
     - Deny
   - For high-risk shell commands, use a separate “Strong Approve” action.

5. Tests.
   - Mock an active tool request and ensure it pauses until approval arrives.
   - Verify deny resolves with `approval_denied`.
   - Verify strong confirmation behavior for destructive commands.
   - Verify patch selected files are passed into `context.approval.approvedFiles`.

## Phase 5: Minimal Frontend

1. Build the first UI as plain static assets.
   - `src/web/static/index.html`
   - `src/web/static/styles.css`
   - `src/web/static/app.js`

2. Layout.
   - Left/main: message stream.
   - Right/side: tool timeline and approval panel.
   - Bottom: composer and mode toggle.
   - Header/status row:
     - model/provider status
     - cwd
     - task mode
     - busy/idle state
     - verification state

3. Frontend behavior.
   - Load initial state from `GET /api/state`.
   - Connect to `GET /api/events`.
   - Submit prompts to `POST /api/chat`.
   - Render streamed assistant text incrementally.
   - Render tool events grouped by call id.
   - Render approval requests and POST the selected decision.
   - Toggle Plan/Act through `POST /api/mode`.

4. Keep the first UI operational, not decorative.
   - Avoid a landing page.
   - The first screen should be the chat workspace.
   - No marketing hero, no heavy animation, no remote fonts.

5. Tests.
   - Unit-test JSON state serialization from the server.
   - Smoke-test static asset serving.
   - Full browser tests can wait unless Playwright is added later.

## Phase 6: Packaging and Build

1. Copy static assets into `dist`.
   - Add a script such as `scripts/copy-web-assets.mjs`.
   - Update `package.json`:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/copy-web-assets.mjs"
  }
}
```

2. Update package contents.
   - If assets live under `dist/web/static`, the existing `"files": ["dist", ...]` is enough.
   - Keep source-only web assets excluded from npm unless needed.

3. Update docs.
   - README:
     - add `grokcode --web`
     - document default URL
     - mention local-only binding
   - `tools.md` probably does not need changes unless web-only tool behavior is added.
   - `docs/PACKAGING.md`: add asset-copy check to packaging notes.

4. Verification.
   - `npm run typecheck`
   - `npm test`
   - `npm run pack:dry-run`
   - Manually test:
     - `npm run dev -- --web`
     - `npm run build && node dist/index.js --web`

## Phase 7: Feature Parity with CLI Commands

After the basic web chat works, add command parity in small slices.

1. Plan/Act mode.
   - Already covered by `POST /api/mode`.

2. Debug log.
   - Add `GET /api/debug-log?limit=10`.
   - Reuse `readDebugLogTail`.

3. Checkpoints.
   - Add:
     - `GET /api/checkpoints`
     - `POST /api/checkpoints`
     - `POST /api/checkpoints/restore`
   - Reuse `createCheckpoint`, `listCheckpoints`, and `restoreCheckpoint`.
   - Keep restore as an explicit active action in the UI.

4. Clipboard image capture.
   - Add `POST /api/clipboard-image`.
   - Reuse `captureClipboardImage`.
   - Return unsupported on non-Windows, matching current behavior.

5. Search result expansion.
   - Port the useful formatting from `src/cli/output.tsx` and `src/cli/ui-format.ts` into web-specific render helpers.

## Phase 8: Later Improvements

These are useful but should not block the first `--web` version.

1. Cancellation.
   - Add `AbortSignal` support to `GrokProvider.streamChat`.
   - Thread it through `runChatTurn`.
   - Implement `POST /api/stop`.

2. Multi-session UI.
   - Add session listing under `.workspace/sessions`.
   - Support new session and switch session.
   - Avoid changing the existing default `current.json` behavior until this is tested.

3. Rich diff rendering.
   - Port `src/cli/diff-renderer.ts` logic or write a small web formatter.
   - Keep file-level patch selection prominent.

4. Optional React/Vite frontend.
   - Consider this only once static JS becomes hard to maintain.
   - If added, keep the built output under `dist/web/static`.
   - Reassess package size before publishing.

## Suggested File Map

Initial implementation files:

- `src/runtime/launch-args.ts`
- `src/web/server.ts`
- `src/web/state.ts`
- `src/web/static/index.html`
- `src/web/static/styles.css`
- `src/web/static/app.js`
- `test/web.test.ts`
- `test/launch-args.test.ts` or equivalent parser tests
- `scripts/copy-web-assets.mjs`

Existing files to modify:

- `src/index.ts`
- `src/runtime/headless.ts`
- `package.json`
- `README.md`
- `docs/PACKAGING.md`

## Recommended First PR Scope

Keep the first implementation intentionally narrow:

1. `--web --port` parsing.
2. Local HTTP server.
3. Static chat UI.
4. `GET /api/state`.
5. `GET /api/events`.
6. `POST /api/chat`.
7. Active-tool approval support.
8. Build asset copy.
9. Tests for parser, server basics, chat streaming, and approvals.

Do not include multi-session management, cancellation, React/Vite, or advanced diff rendering in the first PR. The repo already has a solid runtime; the fastest reliable path is to expose that runtime over a small local web transport first.
