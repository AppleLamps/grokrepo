# GrokCode Development Plan

Status legend:
- [x] Completed
- [~] MVP complete, follow-up work remains
- [ ] Not started

Current status:
- [x] Phase 1 Foundation
- [x] Phase 2 Tool System
- [x] Phase 3 Editing Engine
- [x] Phase 4 Search Tools
- [x] Phase 5 Image System
- [x] Phase 6 Context Engine
- [x] Phase 7 UX Polish
- [~] Phase 8 Packaging
- [~] Phase 9 Agent Product Maturity

Verification status:
- Latest verified build: Windows Node `tsc -p tsconfig.json --noEmit` passed.
- Latest verified tests: Windows Node test runner passed with 164 tests.
- Latest local implementation includes Phase 1 through Phase 7, Phase 8 packaging work, system prompt polish, tool documentation, test hardening, and the main Phase 9 agent maturity slices.
- Test hardening added focused coverage for filesystem tools, patch editing edge cases, session persistence, session restore fallback, path safety, tool lifecycle events, debug logs, UI summaries, and git-aware context scanning.
- Phase 8 packaging metadata, docs, demo guide, and dry-run packaging are present locally and pass. npm publishing is still pending.
- Phase 9 now includes Plan/Act mode, shell risk classification, stronger high-risk shell approval, first-class verification command detection/execution, verification status tracking, richer code navigation, safer file operations, task checkpoints, one-shot/headless mode, expanded Git workflows, and project structure analysis.

---

# Phase 1 — Foundation [x]

Goal:
Create the core CLI runtime and Grok integration.

Deliverables:
- [x] Node.js + TypeScript setup
- [x] CLI entrypoint
- [x] Ink interface
- [x] environment config
- [x] Grok API integration
- [x] streaming responses
- [x] conversation state

Tasks:

## Initialize Project

```bash
npm init -y
```

Install:

```bash
npm install openai ink react dotenv
```

Dev dependencies:

```bash
npm install -D typescript tsx @types/node
```

---

## Configure TypeScript

Create:

```text
tsconfig.json
```

Use:
- strict mode
- ES modules
- NodeNext resolution

---

## Build CLI Entrypoint

Create:

```text
src/index.ts
```

Responsibilities:
- initialize runtime
- load config
- launch Ink app
- manage shutdown

---

## Build Grok Client

Create:

```text
src/providers/grok.ts
```

Responsibilities:
- API requests
- streaming parser
- tool-call handling
- retry logic
- token tracking

---

## Build Session Manager

Create:

```text
src/runtime/session.ts
```

Responsibilities:
- maintain history
- summarize old context
- serialize conversations
- restore sessions

---

# Phase 2 — Tool System [x]

Goal:
Create a unified tool execution framework.

Deliverables:
- [x] tool registry
- [x] tool execution loop
- [x] permission system
- [x] structured outputs

Tasks:

## Create Tool Interface

```ts
interface Tool {
  name: string
  description: string
  execute(args: any): Promise<any>
}
```

---

## Implement Core Tools

Filesystem:
- [x] read_file
- [x] write_file
- [x] list_files
- [x] grep

Git:
- [x] git_status
- [x] git_diff
- [x] git_commit

Shell:
- [x] run_shell

---

## Add Permission System

Rules:
- [x] passive tools auto-run
- [x] active tools require approval

---

## Build Tool Execution Loop

Flow:

```text
Model requests tool
→ execute tool
→ append tool output
→ continue inference
```

---

# Phase 3 — Editing Engine [x]

Goal:
Create reliable code editing workflows.

Deliverables:
- [x] patch generation
- [x] diff rendering
- [x] file application
- [x] rollback support
- [x] edge-case test coverage

Tasks:

## Diff System

Requirements:
- [x] unified diffs
- [x] syntax highlighting
- [x] file-level partial apply support
- [x] create file, missing file, binary file, stale hunk, CRLF, and multi-hunk coverage

---

## Patch Approval UI

Example:

```text
Apply changes? (y/n)
```

---

## Rollback Support

Requirements:
- [x] automatic backups
- [x] undo support
- [x] failed patch recovery

---

# Phase 4 — Search Tools [x]

Goal:
Integrate real-time internet tools.

Deliverables:
- [x] web search
- [x] X search
- [x] search summaries
- [x] citations

Tasks:

## Web Search Tool

Capabilities:
- [x] search docs
- [x] search frameworks
- [x] search GitHub discussions
- [x] fetch current information

---

## X Search Tool

Capabilities:
- [x] search developer conversations
- [x] monitor outages
- [x] detect breaking changes
- [x] summarize live incidents

---

## Search UX

Requirements:
- [x] show tool calls
- [x] show sources in structured tool output
- [x] allow expandable results

---

# Phase 5 — Image System [x]

Goal:
Integrate multimodal workflows.

Deliverables:
- [x] image generation
- [x] image understanding
- [x] workspace asset management

Tasks:

## Image Generation

Capabilities:
- [x] save generated assets
- [x] support aspect ratios
- [x] support variations through image count
- [x] support image editing

Output directory:

```text
.workspace/images/
```

---

## Image Understanding

Capabilities:
- [x] screenshot/local image analysis
- [x] design parsing through image_understand
- [x] OCR-style extraction through image_understand
- [x] UI reference analysis through image_understand

---

## Clipboard + Drag-and-Drop

Support:
- [x] pasted screenshots as data URIs or file paths
- [x] local image files
- [x] drag-and-drop into terminal as inserted file paths
- [x] native Windows OS clipboard image capture

---

# Phase 6 — Context Engine [x]

Goal:
Improve repository understanding.

Deliverables:
- [x] smart context selection
- [x] token budgeting
- [x] LLM-generated summarization

Tasks:

## Repo Scanner

Capabilities:
- [x] detect frameworks
- [x] detect package manager
- [x] identify entrypoints
- [x] detect recent files

---

## Context Builder

Rules:
- [x] prefer nearby files
- [x] prefer recent changes
- [x] prioritize explicit references

---

## Token Budgeting

Requirements:
- [x] estimate tokens
- [x] truncate intelligently
- [x] summarize old context

---

# Phase 7 — UX Polish [x]

Goal:
Make the CLI feel premium.

Deliverables:
- [x] smooth streaming
- [x] clean layouts
- [x] responsive UI
- [x] better logging
- [x] readline-style input movement
- [x] in-terminal debug log viewing

Tasks:

## Improve Terminal Rendering

Requirements:
- [x] clean spacing
- [x] stable cursor behavior
- [x] minimal flicker
- [x] progress indicators

---

## Add Themes

Support:
- [x] dark mode
- [x] light mode
- [x] compact mode

---

## Improve Error Handling

Requirements:
- [x] actionable errors
- [x] retry support
- [x] debug logs
- [x] `/debug` recent log viewer

---

# Phase 8 — Packaging [~]

Goal:
Ship a usable developer product.

Deliverables:
- [x] npm package
- [x] install script
- [x] docs
- [x] demo repo
- [x] tool reference docs

Tasks:

## Publish Package

Requirements:

```bash
npm publish
```

Status:
- [ ] publish to npm
- [x] package metadata
- [x] package file allowlist
- [x] package dry-run verification

---

## Add Install Command

Target:

```bash
npx grokcode
```

Status:
- [x] package bin configured
- [x] README install instructions
- [x] local package verification script

---

## Create Demo Content

Deliver:
- [ ] demo videos
- [x] example repo guide
- [ ] screenshots
- [x] tutorials

---

# Recommended Next Steps

1. Decide whether to publish `grokcode@1.0.0` to npm now or keep it as a local package candidate.
2. Add screenshots or a short demo video if needed before publishing.
3. Publish to npm when ready.
4. Continue Phase 9 follow-ups: safe-command auto-approval settings, shell cancellation behavior, verification recommendations after edits, and deeper failure iteration workflows.

---

# Phase 9 — Agent Product Maturity [~]

Goal:
Close the biggest gaps between GrokCode's current MVP and a mature CLI coding-agent experience while preserving the project's reliability, transparency, and user-controlled execution model.

Deliverables:
- [x] structured Plan/Act task workflow
- [x] shell command risk classification and safer approval UX
- [x] first-class build/test/typecheck verification workflow
- [x] richer code navigation and repository intelligence tools
- [x] task-level checkpoints and rollback
- [x] one-shot/headless CLI mode
- [x] expanded Git workflow tools

Tasks:

## Add Plan/Act Task Mode

Rationale:
The current chat loop can inspect, edit, and verify, but it does not have a first-class separation between planning and implementation. A Plan/Act mode makes larger tasks safer and more predictable.

Requirements:
- [x] add explicit task modes, such as `plan`, `act`, and possibly `auto`
- [x] expose mode controls in the terminal UI, for example `/plan` and `/act`
- [x] ensure Plan mode can inspect context but avoids mutating tools
- [x] require user confirmation before switching from a plan to implementation
- [x] preserve mode state in the workspace session
- [x] update the system prompt so the model follows mode-specific rules

---

## Add Shell Risk Classification

Rationale:
`run_shell` already requires approval, but mature CLI coders benefit from differentiating safe inspection commands from risky mutation, destructive, network, install, or publish commands.

Risk classes:
- [x] `safe`: read-only inspection, such as `git status`, `npm test`, `ls`, `cat`, or `rg`
- [x] `mutating`: writes local files or changes project state
- [x] `destructive`: deletes files, resets history, cleans directories, or force-overwrites data
- [x] `network`: downloads, uploads, installs packages, or calls remote services
- [x] `publish`: releases packages, pushes branches, deploys, or publishes artifacts

Requirements:
- [x] classify shell commands before approval
- [x] show risk level and reason in the approval UI
- [x] require stronger confirmation for destructive and publish commands
- [ ] consider auto-approval settings only for explicitly safe commands
- [ ] add command timeouts and clearer cancellation behavior
- [x] test common risky patterns such as `rm -rf`, `git reset --hard`, `npm publish`, `curl | sh`, and package installs

---

## Add First-Class Verification Workflow

Rationale:
GrokCode can run commands, but verification should become a coherent workflow after code edits rather than an ad hoc shell call.

Requirements:
- [x] detect package manager and likely verification commands from project files
- [x] identify relevant scripts such as `test`, `typecheck`, `lint`, and `build`
- [ ] recommend verification commands after edits
- [ ] optionally run approved verification commands automatically after patch application
- [x] summarize failures with actionable next steps
- [ ] iterate on failures when the user approves fixes
- [x] include verification status in final task summaries

Possible tool/workflow names:
- [x] `detect_verification_commands`
- [x] `verify_changes`
- [ ] `summarize_test_failure`

---

## Add Richer Code Navigation Tools

Rationale:
The current context engine is lightweight and deterministic. It detects repo metadata, explicit files, recent files, and shallow source files, but it lacks deeper code intelligence for larger repositories.

Candidate passive tools:
- [x] `read_file_range`: read specific line ranges from large files
- [x] `list_tree`: recursive or depth-limited tree view with ignore rules
- [x] `list_code_definitions`: list top-level classes, functions, exports, and symbols
- [x] `find_references`: locate call sites and symbol usages
- [x] `analyze_project_structure`: summarize modules, entrypoints, tests, and dependencies

Requirements:
- [x] keep tools deterministic and local-first
- [x] avoid vector database dependency for now
- [x] prefer AST parsing where cheap and reliable, with text fallback where needed
- [x] integrate output into the existing structured tool envelope
- [x] add tests for TypeScript/JavaScript projects first

---

## Add Safer File Operation Tools

Rationale:
Some file operations can be done through shell today, but dedicated tools are safer, easier to preview, and easier to test.

Candidate tools:
- [x] `move_file`
- [x] `delete_file`
- [x] `create_directory`
- [x] `copy_file`
- [x] `file_info`

Requirements:
- [x] keep all operations workspace-confined
- [x] require approval for mutating file operations
- [x] show clear previews before delete, move, or overwrite
- [x] create backups where practical
- [x] support undo through the existing backup/checkpoint system

---

## Add Task-Level Checkpoints

Rationale:
Patch-level undo is useful, but longer tasks need named checkpoints that can restore the workspace to a known state across multiple edits.

Requirements:
- [x] create a checkpoint before a multi-step task starts
- [x] list available checkpoints
- [x] restore a named checkpoint
- [x] associate changed files, patches, command results, and verification results with a task
- [x] expose checkpoint controls in the UI or slash commands
- [x] keep checkpoint data under `.workspace/`

Candidate commands/tools:
- [x] `/checkpoint create [name]`
- [x] `/checkpoint list`
- [x] `/checkpoint restore [id]`
- [x] `checkpoint_create`
- [x] `checkpoint_list`
- [x] `checkpoint_restore`

---

## Add One-Shot And Headless CLI Mode

Rationale:
The current product is terminal-interactive. A mature CLI coder should also support automation, scripts, and CI-style use cases.

Example usage:

```bash
grokcode "explain this repo"
grokcode --print "summarize the current git diff"
grokcode --json "list likely test commands"
grokcode --yes-safe "run the test suite and summarize failures"
```

Requirements:
- [x] accept a prompt as a CLI argument
- [x] support non-interactive output with `--print`
- [x] support structured JSON output with `--json`
- [x] define approval behavior for headless mode
- [x] allow safe passive tools without prompts
- [x] never allow risky active tools in headless mode unless explicitly configured
- [x] return useful process exit codes

---

## Expand Git Workflow Tools

Rationale:
GrokCode has `git_status`, `git_diff`, and approved `git_commit`. More Git workflow coverage would reduce reliance on raw shell commands.

Candidate tools:
- [x] `git_log`
- [x] `git_branch`
- [x] `git_stage`
- [x] `git_restore`
- [x] `git_show`
- [x] `git_diff_file`

Requirements:
- [x] keep read-only Git tools passive
- [x] require approval for staging, restoring, branch switching, or other mutating operations
- [x] show clear previews for destructive Git operations
- [x] integrate Git summaries into final task reports

---

## Optional Later: Provider And Plugin Extensibility

Rationale:
GrokCode is intentionally Grok-first and currently avoids MCP, autonomous agents, vector databases, and plugin complexity. That is appropriate for the MVP, but extensibility may matter later for power users.

Possible future work:
- [ ] support additional OpenAI-compatible providers
- [ ] allow per-task model override
- [ ] add local custom tool configuration
- [ ] reconsider MCP only after core safety and workflow maturity are strong

---

# Current File Tree

```text
src/
  index.ts

  cli/
    app.tsx
    approval-panel.tsx
    composer.tsx
    debug-panel.tsx
    header.tsx
    help-panel.tsx
    input.tsx
    message-list.tsx
    output.tsx
    status-bar.tsx
    tool-timeline.tsx

  context/
    builder.ts
    scanner.ts
    types.ts

  editing/
    backups.ts
    diff.ts
    engine.ts

  providers/
    grok.ts
    images.ts
    search.ts

  runtime/
    chat.ts
    headless.ts
    session.ts
    session-store.ts
    summarization.ts

  tools/
    checkpoints.ts
    editing.ts
    file-ops.ts
    filesystem.ts
    git.ts
    images.ts
    navigation.ts
    registry.ts
    search.ts
    shell-risk.ts
    shell.ts
    verification.ts

  prompts/
    system.ts

  utils/
    config.ts
    debug-log.ts
```

---

# Final Goal

Build a terminal-native multimodal engineering assistant that can:
- reason about code
- research live information
- understand images
- generate assets
- safely modify repositories
- operate through tools

without feeling chaotic, slow, or untrustworthy.

