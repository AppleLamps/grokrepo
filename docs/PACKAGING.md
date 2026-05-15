# GrokCode Packaging

## Local Verification

Run the full package check before publishing:

```bash
npm test
npm run verify:package
```

This runs the test suite, builds `dist/`, and runs `npm pack --dry-run`.

Current verified local result:

- `npm run build` passed.
- `npm test` passed with 118 tests.
- `npm run verify:package` passed during Phase 8 packaging.

## Publish

```bash
npm publish
```

The package exposes this command:

```bash
grokcode
```

After publish, users can run:

```bash
npx grokcode
```

## Published Files

The npm package is intentionally small. It includes:

- `dist/`
- `README.md`
- `.env.example`
- `package.json`

It excludes source files, tests, local docs, `.workspace/`, and local API reference material.

The local docs that do not ship to npm are:

- `PLAN.md`
- `UIPLAN.md`
- `tools.md`
- `docs/`
- `demo/`

## Runtime Configuration

Required for live API calls:

```text
XAI_API_KEY=
```

Useful options:

```text
GROKCODE_THEME=dark
GROKCODE_DEBUG=false
GROKCODE_MOCK=false
```

Debug mode writes redacted logs to `.workspace/logs/grokcode-debug.log`. The CLI can show recent log entries with `/debug`.

On Windows, `/clip` captures a bitmap image from the native OS clipboard into `.workspace/images` and then submits it for analysis.
