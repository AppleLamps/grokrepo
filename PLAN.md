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
- [ ] Phase 8 Packaging

Verification status:
- Latest verified build: `npm run build` passed.
- Latest verified tests: `npm test` passed with 88 tests.
- Latest pushed implementation includes Phase 1 through Phase 6.
- Phase 7 UI polish is present locally and passes, but is not committed yet.

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
npm install openai ink react chalk ora dotenv
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

Tasks:

## Diff System

Requirements:
- [x] unified diffs
- [x] syntax highlighting
- [x] file-level partial apply support

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
- [ ] native OS clipboard image capture

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

---

# Phase 8 — Packaging [ ]

Goal:
Ship a usable developer product.

Deliverables:
- [ ] npm package
- [ ] install script
- [ ] docs
- [ ] demo repo

Tasks:

## Publish Package

Requirements:

```bash
npm publish
```

---

## Add Install Command

Target:

```bash
npx grokcode
```

---

## Create Demo Content

Deliver:
- demo videos
- example repos
- screenshots
- tutorials

---

# Recommended Next Steps

1. Start Phase 8 packaging after UX polish stabilizes.
2. Add native OS clipboard image capture only if the terminal UI needs it.
3. Continue optional UI refinements: richer debug-log viewing and full readline-style cursor movement.

---

# Suggested Initial File Tree

```text
src/
  index.ts

  cli/
    app.tsx
    input.tsx
    output.tsx

  runtime/
    session.ts
    context.ts
    approvals.ts

  providers/
    grok.ts

  tools/
    filesystem/
    git/
    shell/
    web/
    images/

  prompts/
    system.ts
    coding.ts

  utils/
    diff.ts
    logger.ts
    tokens.ts
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

