# GrokCode

A terminal-native AI engineering assistant powered by Grok 4.3.

GrokCode is a local developer runtime for chat, code inspection, patch editing, search, image workflows, and approved tool execution. It is designed to stay deterministic and transparent: passive tools can inspect context, active tools ask before mutating anything.

## Status

Current local build:

- Phases 1 through 7 are complete.
- Phase 8 packaging is implemented locally and still needs npm publish plus optional demo media.
- Phase 9 agent maturity slices are implemented: Plan/Act mode, shell risk classification, verification tools, code navigation, task checkpoints, safer file operations, one-shot/headless mode, expanded Git workflows, and project structure analysis.
- Latest verified suite: TypeScript `--noEmit` passed and the Windows Node test runner passed with 164 tests.

## Install

Local development:

```bash
npm install
npm run dev
```

Build and run the compiled CLI:

```bash
npm run build
npm start
```

Package usage after publishing:

```bash
npx grokcode
```

Global install after publishing:

```bash
npm install -g grokcode
grokcode
```

## Configuration

Create a `.env` file or export environment variables:

```text
XAI_API_KEY=
GROK_MODEL=grok-4.3
GROK_IMAGE_MODEL=grok-imagine-image-quality
GROK_BASE_URL=https://api.x.ai/v1
GROKCODE_THEME=dark
GROKCODE_DEBUG=false
GROKCODE_MOCK=false
```

Options:

- `GROKCODE_THEME`: `dark`, `light`, or `compact`.
- `GROKCODE_DEBUG=true`: writes redacted events to `.workspace/logs/grokcode-debug.log`.
- `GROKCODE_MOCK=true`: runs the local chat loop without calling the API.

## CLI Controls

Inside the terminal UI:

- `/exit` or `/quit`: close the app.
- `/help`: show or hide command help.
- `/retry`: retry the last submitted prompt.
- `/plan`: switch to read-only planning mode.
- `/act`: switch to implementation mode.
- `/mode`: report the current task mode.
- `/checkpoint create [name]`: create a task checkpoint.
- `/checkpoint list`: list saved task checkpoints.
- `/checkpoint restore [id]`: restore a task checkpoint.
- `/debug`: show or hide recent debug log entries.
- `/clip [prompt]`: capture the current Windows clipboard image, save it, and ask GrokCode to analyze it.
- `Tab`: expand or collapse the latest search result details. This global shortcut is reserved for search detail toggling.
- `Up` and `Down`: navigate command history.
- `Left` and `Right`: move within the current input.
- `Ctrl+A` and `Ctrl+E`: jump to start or end of input.
- `Ctrl+U`: clear before the cursor.
- `Ctrl+K`: clear after the cursor.
- `Ctrl+W`: delete the previous word.

## One-Shot Mode

Run a single non-interactive prompt by passing it as arguments:

```bash
grokcode "explain this repo"
grokcode --print "summarize the current git diff"
grokcode --json "list likely test commands"
grokcode --yes-safe "run the test suite and summarize failures"
```

Headless mode allows passive tools automatically. Active tools are denied by default. `--yes-safe` only approves safe verification-style active commands, such as `verify_changes` or safe test/typecheck/lint/build shell commands.

`--json` includes assistant content, exit code, usage, context metadata, verification status, and tool events.

Exit codes:

- `0`: success
- `1`: startup or runtime error
- `2`: active tool denied or blocked
- `3`: verification failed

## Verification

Run these before publishing or pushing major changes:

```bash
npm run typecheck
npm test
npm run pack:dry-run
```

Full package verification:

```bash
npm run verify:package
```

The npm package is intentionally small. It ships `dist/`, `README.md`, `.env.example`, `tools.md`, and package metadata.

## Features

GrokCode currently includes:

- streaming multi-turn chat
- repository context scanning
- project structure analysis
- Plan/Act task mode
- conversation summarization
- workspace session persistence
- filesystem inspection
- safer workspace file operations
- Git inspection, staging, restore, diff, log, show, and approved commits
- approved shell execution with risk classification
- verification command detection and approved verification runs
- task checkpoints and restore
- one-shot/headless prompt execution
- patch-based editing with backups and undo
- web search with citations
- X search with citations
- image understanding
- image generation
- image editing
- native Windows clipboard image capture
- terminal UI themes
- debug logs and in-terminal debug viewing

## Tool System

Tools are registered in `src/tools/index.ts` and exposed to the model through OpenAI-compatible function calling.

Passive tools can run automatically:

- `read_file`
- `file_info`
- `read_file_range`
- `list_files`
- `list_tree`
- `grep`
- `list_code_definitions`
- `find_references`
- `analyze_project_structure`
- `git_status`
- `git_diff`
- `git_log`
- `git_branch`
- `git_show`
- `git_diff_file`
- `web_search`
- `x_search`
- `image_understand`
- `detect_verification_commands`
- `checkpoint_list`

Active tools require explicit approval:

- `write_file`
- `create_directory`
- `copy_file`
- `move_file`
- `delete_file`
- `run_shell`
- `verify_changes`
- `checkpoint_create`
- `checkpoint_restore`
- `git_commit`
- `git_stage`
- `git_restore`
- `apply_patch`
- `undo_patch`
- `image_generate`
- `image_edit`
- `capture_clipboard_image`

See `tools.md` for the full tool reference.

## Editing Workflow

Normal code edits use `apply_patch`.

The editing flow is:

1. Read the target file.
2. Generate a unified diff with workspace-relative paths.
3. Show a file-level preview.
4. Ask for approval.
5. Apply selected files.
6. Create backups under `.workspace/patches/`.
7. Roll back automatically on failed partial application.

`undo_patch` can restore the latest backup or a named backup id.

`write_file` remains available for new files, generated files, or intentional full-file replacement.

## Search And Images

Search tools use xAI's Responses API internally:

- `web_search`: current facts, docs, framework changes, live web sources.
- `x_search`: live developer discussion, outages, unofficial fixes, breaking changes.

Image tools use Grok vision and Grok Imagine:

- `image_understand`: local image paths, public URLs, file URLs, and image data URIs.
- `image_generate`: approved generation saved under `.workspace/images`.
- `image_edit`: approved edits to one to three source images saved under `.workspace/images`.
- `capture_clipboard_image`: approved native Windows clipboard bitmap capture saved under `.workspace/images`.

Terminal drag and paste workflows are supported when the terminal inserts a file path, file URL, or data URI. On Windows, `/clip` captures the current bitmap image from the OS clipboard and saves it as a PNG.

## Context Engine

GrokCode builds lightweight repository context before each user turn.

The context engine detects:

- package manager
- frameworks
- entrypoints
- git branch and status
- recently changed files
- explicit file references in the latest prompt

Repo context is temporary guidance. The model is instructed to use `read_file` before making exact code claims or edits.

Long conversations can be summarized when the active history passes the configured threshold. Raw messages remain in session state for auditability.

## Session Persistence

GrokCode restores the latest workspace session on launch.

Policy:

- Session file: `.workspace/sessions/current.json`.
- Autosave cadence: after each user prompt, conversation summary update, assistant reply, and tool result.
- Exit handling: `/exit`, `SIGINT`, and `SIGTERM` save the current session before shutdown.
- Corrupt session handling: startup falls back to a fresh session and records the restore failure in the debug log when `GROKCODE_DEBUG=true`.

The `.workspace/` directory is ignored by git, so transcripts, tool results, summaries, images, patch backups, and debug logs stay local by default.

## Project Structure

```text
src/
  cli/
  context/
  editing/
  prompts/
  providers/
  runtime/
  tools/
  utils/

test/
  context.test.ts
  editing.test.ts
  images.test.ts
  runtime.test.ts
  search.test.ts
  summarization.test.ts
  tools.test.ts
  ux.test.ts
  workflows.test.ts

.workspace/
  checkpoints/
  images/
  logs/
  patches/
  sessions/
```

## Packaging

Packaging notes live in `docs/PACKAGING.md`.

Demo prompts and local verification steps live in `demo/README.md`.

Publish command:

```bash
npm publish
```

## Development Philosophy

GrokCode prioritizes:

1. reliability
2. transparency
3. deterministic behavior
4. speed
5. strong terminal UX

Avoid:

- hidden actions
- uncontrolled file edits
- fake autonomy
- vector databases
- MCP
- autonomous agents

Those features can be reconsidered later, but they are outside the current MVP.
