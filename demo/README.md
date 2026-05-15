# GrokCode Demo

This demo gives a quick local script for validating the packaged CLI.

## Setup

```bash
npm install
cp .env.example .env
npm run build
```

Set `XAI_API_KEY` in `.env`, or use mock mode:

```text
GROKCODE_MOCK=true
```

## Try The CLI

```bash
npm run dev
```

Useful prompts:

```text
what kind of project is this?
read README.md and summarize the install flow
use web_search to check current xAI docs for image editing
create a tiny patch that updates a comment, then show me the approval
```

Useful controls:

```text
/debug
/retry
Tab
Up and Down
Left and Right
Ctrl+A and Ctrl+E
Ctrl+U, Ctrl+K, and Ctrl+W
```

## Package Check

```bash
npm test
npm run verify:package
```

This verifies the test suite, builds the CLI, and shows the files that would ship to npm.
