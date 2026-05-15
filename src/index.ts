#!/usr/bin/env node
import process from "node:process";

import { render } from "ink";
import React from "react";

import { App } from "./cli/app.js";
import { DefaultContextBuilder } from "./context/index.js";
import { GrokProvider } from "./providers/grok.js";
import { ImageProvider } from "./providers/images.js";
import { SearchProvider } from "./providers/search.js";
import { Session } from "./runtime/session.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import { loadConfig } from "./utils/config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const provider = new GrokProvider(config);
  const imageProvider = new ImageProvider(config);
  const searchProvider = new SearchProvider(config);
  const contextBuilder = new DefaultContextBuilder();
  const session = new Session();
  const registry = createDefaultToolRegistry();

  const instance = render(
    React.createElement(App, { config, contextBuilder, provider, imageProvider, registry, searchProvider, session })
  );

  const shutdown = (): void => {
    instance.unmount();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await instance.waitUntilExit();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`GrokCode failed to start: ${message}\n`);
  process.exitCode = 1;
});
