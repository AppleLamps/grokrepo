#!/usr/bin/env node
import process from "node:process";

import { render } from "ink";
import React from "react";

import { App } from "./cli/app.js";
import { DefaultContextBuilder } from "./context/index.js";
import { GrokProvider } from "./providers/grok.js";
import { ImageProvider } from "./providers/images.js";
import { SearchProvider } from "./providers/search.js";
import { restoreOrCreateSession, saveSession } from "./runtime/session-store.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import { loadConfig } from "./utils/config.js";
import { writeDebugLog } from "./utils/debug-log.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const provider = new GrokProvider(config);
  const imageProvider = new ImageProvider(config);
  const searchProvider = new SearchProvider(config);
  const contextBuilder = new DefaultContextBuilder();
  const restoredSession = await restoreOrCreateSession(process.cwd());
  const { session } = restoredSession;
  const registry = createDefaultToolRegistry();

  if (restoredSession.error) {
    await writeDebugLog(process.cwd(), config.debug, "session.restore_failed", restoredSession.error);
  }

  const instance = render(
    React.createElement(App, {
      config,
      contextBuilder,
      provider,
      imageProvider,
      registry,
      searchProvider,
      session,
      sessionPath: restoredSession.path
    })
  );

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    instance.unmount();
    await saveSession(session, restoredSession.path);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await instance.waitUntilExit();
  await saveSession(session, restoredSession.path);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`GrokCode failed to start: ${message}\n`);
  process.exitCode = 1;
});
