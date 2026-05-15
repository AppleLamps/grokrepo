# GrokCode UI/UX Polish Plan

## Summary
Create a focused Phase 7 UI/UX pass for the Ink terminal interface. The goal is to make GrokCode clearer, calmer, and more professional while preserving runtime behavior. Prioritize visual hierarchy, tool activity readability, approval clarity, and input ergonomics.

## Implementation Steps
- [x] Split the current UI into `Header`, `MessageList`, `ToolTimeline`, `ApprovalPanel`, `StatusBar`, and `Composer`.
- [x] Add shared formatting helpers for labels, state colors, separators, truncation, and compact summaries.
- [x] Replace repeated raw tool rows with grouped tool timeline rows keyed by tool call id.
- [x] Redesign approvals as a focused panel with selected file counts and separated controls.
- [x] Keep existing keyboard behavior: Tab expands the latest search result, y/n approvals, patch file toggles.
- [x] Keep dependencies unchanged.
- [x] Add targeted UI tests for timeline grouping, state labels, approval model text, status bar parts, search expansion, and composer states.
- [x] Verify with `npm run build`, `npm test`, and `npm run dev`.
- [x] Compact long provider status text so the header is less likely to wrap in normal terminals.
- [x] Stabilize composer prompt width so disabled/enabled states do not shift the input row.
- [x] Reduce tool timeline churn by storing the latest event per tool call in app state.
- [x] Add `GROKCODE_THEME` support for dark, light, and compact modes.
- [x] Add `GROKCODE_DEBUG` status visibility for debug sessions.
- [x] Add debug log writing under `.workspace/logs/grokcode-debug.log` when `GROKCODE_DEBUG` is enabled.
- [x] Add `/retry` command and visible retry hint after errors.
- [x] Add command history navigation with up/down arrows.
- [ ] Continue polish on richer debug-log viewing and full readline-style cursor movement.

## Acceptance Criteria
- [x] The app remains terminal-native and dense.
- [x] User, assistant, tools, approvals, and status areas have distinct labels.
- [x] Tool activity is grouped by call id and uses readable states.
- [x] Search expansion and patch diff previews still work.
- [x] Busy, disabled, error, token, and context states are visible through the status bar.
- [x] Dark, light, and compact theme modes are supported without new dependencies.
- [x] Retry, debug logging, and input history are implemented without changing dependencies.
- [x] Phase 7 progress is reflected in `PLAN.md`.
