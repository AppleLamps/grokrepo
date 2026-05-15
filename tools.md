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

## Git Tools

### `git_status`

- Permission: `passive`
- Purpose: runs concise git status for the workspace.
- Arguments: none.
- Output includes stdout, stderr, and exit code.
- Typical use: inspect changed files before committing or reporting status.

### `git_diff`

- Permission: `passive`
- Purpose: shows the current workspace diff.
- Arguments: none.
- Output includes stdout, stderr, and exit code.
- Typical use: review local changes before summarizing, testing, or committing.

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
- Output includes stdout, stderr, and exit code.
- Typical use: build, test, inspect environment state, run package scripts, or execute user-approved commands.

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
- Tool results are appended back into conversation history so the model can continue from evidence.
- Recent tool activity appears in the grouped terminal timeline.
- Search results can be expanded with `Tab`.
