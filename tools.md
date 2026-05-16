# GrokCode Tools

This file lists the tools registered by GrokCode and the role each one plays in the runtime. Tool behavior is defined in `src/tools/`. The README gives the short overview. This file is the detailed local reference.

## Permission Model

- `passive`: may run automatically when useful. These tools inspect, search, or analyze without mutating the local workspace.
- `active`: requires explicit user approval before execution. These tools can write files, run commands, create commits, apply patches, or save generated assets.

All tool results use the same structured envelope:

```json
{
  "ok": true,
  "tool": "tool_name",
  "output": {},
  "error": {
    "code": "error_code",
    "message": "error message"
  },
  "metadata": {}
}
```

`error` appears only for failed results. `metadata` appears when a tool has extra execution details.

## Filesystem Tools

### `read_file`

- Permission: `passive`
- Purpose: reads a UTF-8 text file from the workspace.
- Arguments:
  - `path`: workspace-relative file path.
- Output includes the normalized path, file size, and file content.
- Typical use: inspect source files before explaining or editing them.

### `list_files`

- Permission: `passive`
- Purpose: lists files and directories inside a workspace directory.
- Arguments:
  - `path`: optional workspace-relative directory path. Defaults to the workspace root.
- Output includes entry names, paths, type, and size.
- Typical use: explore project structure before selecting files.

### `grep`

- Permission: `passive`
- Purpose: searches workspace files for text or a ripgrep pattern.
- Arguments:
  - `query`: text or ripgrep pattern.
  - `path`: optional workspace-relative file or directory. Defaults to the workspace root.
- Uses `rg` when available and falls back to a deterministic Node search.
- Output includes up to 200 matches with path, line, column, and text.
- Typical use: locate symbols, call sites, tests, and configuration.

### `write_file`

- Permission: `active`
- Purpose: writes exact UTF-8 content to a workspace file.
- Arguments:
  - `path`: workspace-relative target path.
  - `content`: exact file content to write.
- Output includes the target path and bytes written.
- Typical use: create new generated files or intentionally replace a full file.
- Normal edits to existing code should use `apply_patch`.

## Safer File Operation Tools

### `file_info`

- Permission: `passive`
- Purpose: inspects workspace file or directory metadata.
- Arguments:
  - `path`: workspace-relative path.
  - `includeHash`: optional boolean to include SHA-256 for files.
- Output includes path, type, size, modified time, and optional hash.
- Typical use: inspect file state before copying, moving, deleting, or reporting.

### `create_directory`

- Permission: `active`
- Purpose: creates a workspace directory.
- Arguments:
  - `path`: workspace-relative directory path.
- Output includes created path.
- Typical use: create target folders without shell commands.

### `copy_file`

- Permission: `active`
- Purpose: copies a file within the workspace.
- Arguments:
  - `source`: workspace-relative source file.
  - `destination`: workspace-relative destination file.
  - `overwrite`: optional boolean. Defaults to false.
- Output includes source, destination, overwrite status, and bytes copied.
- Typical use: duplicate files with explicit overwrite protection.

### `move_file`

- Permission: `active`
- Purpose: moves or renames a workspace path.
- Arguments:
  - `source`: workspace-relative source path.
  - `destination`: workspace-relative destination path.
  - `overwrite`: optional boolean. Defaults to false.
- Output includes source, destination, and overwrite status.
- Typical use: rename or reorganize files without raw shell commands.

### `delete_file`

- Permission: `active`
- Purpose: soft-deletes a workspace file or directory into `.workspace/trash`.
- Arguments:
  - `path`: workspace-relative path to delete.
- Output includes trash id, original path, trash path, deletion time, type, and size.
- Typical use: remove files while preserving recovery metadata.

## Code Navigation Tools

### `read_file_range`

- Permission: `passive`
- Purpose: reads a specific 1-based line range from a UTF-8 workspace text file.
- Arguments:
  - `path`: workspace-relative file path.
  - `startLine`: optional 1-based first line. Defaults to 1.
  - `endLine`: optional 1-based final line. Defaults to `startLine + 199`.
- Output includes path, selected range, total line count, raw content, and line-numbered entries.
- Typical use: inspect a focused part of a large file.

### `list_tree`

- Permission: `passive`
- Purpose: lists a depth-limited workspace tree using standard ignore rules.
- Arguments:
  - `path`: optional workspace-relative directory. Defaults to root.
  - `maxDepth`: optional maximum depth. Defaults to 2.
  - `maxEntries`: optional maximum entries. Defaults to 200.
- Ignores `.git`, `node_modules`, `dist`, and `.workspace`.
- Output includes paths, names, types, depth, file sizes, and truncation state.
- Typical use: scan project layout before choosing files.

### `list_code_definitions`

- Permission: `passive`
- Purpose: lists top-level JavaScript and TypeScript symbols from a file or directory.
- Arguments:
  - `path`: optional file or directory. Defaults to root.
  - `maxFiles`: optional maximum code files to scan. Defaults to 50.
  - `maxDefinitions`: optional maximum definitions. Defaults to 200.
- Output includes code files scanned and definitions with path, line, kind, name, export status, and signature.
- Typical use: orient around modules, exports, and important symbols.

### `find_references`

- Permission: `passive`
- Purpose: finds workspace references to a symbol or exact text.
- Arguments:
  - `query`: symbol or exact text to find.
  - `path`: optional workspace-relative file or directory. Defaults to root.
  - `maxResults`: optional maximum matches. Defaults to 200.
- Uses `rg --fixed-strings` when available and falls back to deterministic Node search.
- Output includes query, matches with path/line/column/text, and truncation state.
- Typical use: locate call sites, symbol usages, and related tests.

### `analyze_project_structure`

- Permission: `passive`
- Purpose: summarizes local modules, entrypoints, tests, dependencies, scripts, and git context.
- Arguments: none.
- Output includes package manager, frameworks, entrypoints, key files, modules, tests, package scripts, dependencies, dev dependencies, and git metadata.
- Typical use: orient around the project before planning larger changes.

## Git Tools

### `git_status`

- Permission: `passive`
- Purpose: runs concise git status for the workspace.
- Arguments: none.
- Output includes stdout, stderr, and exit code.
- Typical use: inspect changed files before committing or reporting status.

### `git_diff`

- Permission: `passive`
- Purpose: shows the current workspace diff, split into unstaged and staged sections.
- Arguments: none.
- Output includes combined stdout, stderr, exit code, and separate unstaged and staged command results.
- Typical use: review local changes before summarizing, testing, or committing.

### `git_log`

- Permission: `passive`
- Purpose: shows recent commits.
- Arguments:
  - `maxCount`: optional maximum commits. Defaults to 10.
- Output includes raw stdout and parsed commit metadata.
- Typical use: understand recent history and change context.

### `git_branch`

- Permission: `passive`
- Purpose: shows the current branch and local branches.
- Arguments: none.
- Output includes current branch and branch list.
- Typical use: orient Git workflow state before staging or committing.

### `git_show`

- Permission: `passive`
- Purpose: shows a git object, commit, or file at a revision.
- Arguments:
  - `ref`: optional git ref. Defaults to `HEAD`.
  - `path`: optional file path at the ref.
- Output includes stdout, stderr, and exit code.
- Typical use: inspect prior versions or commit details.

### `git_diff_file`

- Permission: `passive`
- Purpose: shows git diff for a single workspace file.
- Arguments:
  - `path`: workspace-relative file path.
  - `staged`: optional boolean for staged diff.
- Output includes stdout, stderr, and exit code.
- Typical use: inspect a focused file diff before editing or staging.

### `git_stage`

- Permission: `active`
- Purpose: stages selected files with `git add`.
- Arguments:
  - `paths`: workspace-relative paths to stage.
- Output includes staged paths, stdout, stderr, and exit code.
- Typical use: prepare approved changes for commit.

### `git_restore`

- Permission: `active`
- Purpose: restores worktree files from a ref or unstages selected paths.
- Arguments:
  - `paths`: workspace-relative paths to restore or unstage.
  - `staged`: optional boolean. When true, runs `git restore --staged`.
  - `source`: optional source ref for worktree restore. Defaults to `HEAD`.
- Preview behavior: approval shows mode, paths, and focused `git diff` or `git diff --staged` output.
- Safety behavior: worktree restore writes a backup under `.workspace/git-restore/` before running git.
- Output includes paths, mode, source, stdout, stderr, exit code, and backup metadata.
- Typical use: discard approved worktree changes or unstage files without raw shell commands.

### `git_commit`

- Permission: `active`
- Purpose: creates a git commit with an explicit message.
- Arguments:
  - `message`: commit message passed to git.
- Output includes stdout, stderr, and exit code.
- Typical use: commit approved local changes after status and diff review.

## Shell Tool

### `run_shell`

- Permission: `active`
- Purpose: runs an exact shell command in the workspace.
- Arguments:
  - `command`: exact command string.
- Approval behavior: shows a risk class and reason before execution. `destructive` and `publish` commands require `!` confirmation.
- Risk classes: `safe`, `mutating`, `destructive`, `network`, and `publish`.
- Output includes stdout, stderr, exit code, and risk metadata.
- Typical use: build, test, inspect environment state, run package scripts, or execute user-approved commands.

## Verification Tools

### `detect_verification_commands`

- Permission: `passive`
- Purpose: detects likely local verification commands from package metadata.
- Arguments: none.
- Output includes package manager, package scripts, and commands for `typecheck`, `lint`, `test`, and `build` when present.
- Typical use: decide which checks should run after code changes.

### `verify_changes`

- Permission: `active`
- Purpose: runs approved local verification commands sequentially.
- Arguments:
  - `commands`: optional exact verification command list. Defaults to detected package verification commands.
  - `reason`: optional short reason for running verification.
- Safety behavior: rejects commands classified as `destructive`, `publish`, `network`, or otherwise unsafe for verification.
- Output includes command results, elapsed time, and the first failed command when present.
- Typical use: run build, typecheck, lint, or test commands after edits.

## Checkpoint Tools

### `checkpoint_create`

- Permission: `active`
- Purpose: creates a task checkpoint snapshot under `.workspace/checkpoints`.
- Arguments:
  - `name`: optional human-readable checkpoint name.
- Snapshot scope: Git-visible tracked and untracked files, excluding ignored files and `.workspace`, `node_modules`, `dist`, and `.git`.
- Output includes checkpoint id, name, creation time, file count, and changed files from git status when available.
- Typical use: save a known workspace state before multi-step edits.

### `checkpoint_list`

- Permission: `passive`
- Purpose: lists saved task checkpoints.
- Arguments: none.
- Output includes checkpoint id, name, creation time, file count, and changed files.
- Typical use: choose a checkpoint to restore.

### `checkpoint_restore`

- Permission: `active`
- Purpose: restores a task checkpoint snapshot after approval.
- Arguments:
  - `id`: optional checkpoint id. Defaults to the latest checkpoint.
- Restore behavior: restores checkpointed files and removes Git-visible files created after the checkpoint.
- Output includes restored and removed files.
- Typical use: return the workspace to a known state after a multi-step task.

## Editing Tools

### `apply_patch`

- Permission: `active`
- Purpose: applies a unified diff patch after approval.
- Arguments:
  - `patch`: unified diff patch text.
  - `summary`: optional short change summary.
- Preview behavior: shows changed files and a trimmed, syntax-colored diff before approval.
- Approval behavior: supports applying all files, skipping all files, or approving a subset of files.
- Output includes applied files, skipped files, backup id, and errors when present.
- Typical use: normal code edits to existing files.

### `undo_patch`

- Permission: `active`
- Purpose: restores files from a previous patch backup.
- Arguments:
  - `backupId`: optional backup id. Defaults to the latest patch backup.
- Output includes restored files and backup metadata.
- Typical use: undo the most recent approved patch or restore a named backup.

## Search Tools

### `web_search`

- Permission: `passive`
- Purpose: searches the live web through the xAI Responses API.
- Arguments:
  - `query`: search question or topic.
  - `allowedDomains`: optional list of domains to restrict search to. Maximum 5.
  - `excludedDomains`: optional list of domains to exclude. Maximum 5.
  - `enableImageUnderstanding`: optional boolean for image analysis during search.
- `allowedDomains` and `excludedDomains` are mutually exclusive.
- Output includes query, generated summary, URL citations, token usage, and raw tool usage when available.
- Typical use: current facts, documentation lookup, framework changes, external sources, and live web information.

### `x_search`

- Permission: `passive`
- Purpose: searches X posts through the xAI Responses API.
- Arguments:
  - `query`: X search question or topic.
  - `allowedXHandles`: optional handles to restrict search to. Maximum 10.
  - `excludedXHandles`: optional handles to exclude. Maximum 10.
  - `fromDate`: optional start date in `YYYY-MM-DD` format.
  - `toDate`: optional end date in `YYYY-MM-DD` format.
  - `enableImageUnderstanding`: optional boolean for image analysis in posts.
  - `enableVideoUnderstanding`: optional boolean for video analysis in posts.
- `allowedXHandles` and `excludedXHandles` are mutually exclusive.
- Output includes query, generated summary, URL citations, token usage, and raw tool usage when available.
- Typical use: live developer discussion, outages, breaking changes, unofficial fixes, and X posts.

## Image Tools

### `image_understand`

- Permission: `passive`
- Purpose: analyzes a local image, public image URL, file URL, or image data URI with Grok vision.
- Arguments:
  - `path`: workspace-relative local image path.
  - `imageUrl`: public image URL or data URI.
  - `prompt`: optional analysis instruction.
- Provide exactly one of `path` or `imageUrl`.
- Output includes a concise model-generated visual analysis.
- Typical use: screenshots, UI references, diagrams, OCR-style extraction, and visual debugging.

### `capture_clipboard_image`

- Permission: `active`
- Purpose: captures the current native Windows clipboard bitmap image and saves it under `.workspace/images`.
- Arguments: none.
- Output includes the saved workspace path, file size, and platform.
- Failure modes include `unsupported_platform`, `clipboard_empty`, and `clipboard_capture_failed`.
- Typical use: import a screenshot copied to the Windows clipboard before using `image_understand` or `image_edit`.

### `image_generate`

- Permission: `active`
- Purpose: generates image assets with Grok Imagine and saves them under `.workspace/images`.
- Arguments:
  - `prompt`: detailed generation prompt.
  - `count`: optional number of images. Defaults to 1. Maximum 10.
  - `aspectRatio`: optional aspect ratio, such as `1:1`, `16:9`, `9:16`, or `auto`.
  - `resolution`: optional output resolution, `1k` or `2k`.
- Output includes saved file paths and asset metadata.
- Typical use: visual assets, hero images, placeholders, Open Graph images, icons, and illustrations.

### `image_edit`

- Permission: `active`
- Purpose: edits one to three source images with Grok Imagine and saves results under `.workspace/images`.
- Arguments:
  - `prompt`: natural language edit instruction.
  - `images`: one to three image sources. Each source can be a workspace path, public URL, file URL, or image data URI.
  - `aspectRatio`: optional output aspect ratio.
  - `resolution`: optional output resolution, `1k` or `2k`.
- Output includes saved file paths and asset metadata.
- Typical use: natural-language edits to generated images, screenshots, or provided image assets.

## Runtime Notes

- Tools are registered in `src/tools/index.ts`.
- Tool schemas are exposed to the model through OpenAI-compatible function calling.
- Passive tools execute immediately.
- Active tools route through the Ink approval UI before execution.
- Plan mode exposes only passive tools and blocks active tool calls. Act mode preserves normal approval behavior.
- Headless mode denies active tools by default. `--yes-safe` only approves safe verification-style active commands.
- Verification status from `verify_changes` is tracked for status display and headless JSON output.
- Slash commands `/checkpoint create`, `/checkpoint list`, and `/checkpoint restore` manage task checkpoints directly.
- Tool results are appended back into conversation history so the model can continue from evidence.
- Recent tool activity appears in the grouped terminal timeline.
- Search results can be expanded with `Tab`.
