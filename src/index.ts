#!/usr/bin/env node
import process from "node:process";

import { render } from "ink";
import React from "react";

import { App } from "./cli/app.js";
import { DefaultContextBuilder } from "./context/index.js";
import { GrokProvider } from "./providers/grok.js";
import { ImageProvider } from "./providers/images.js";
import { SearchProvider } from "./providers/search.js";
import { parseHeadlessArgs, renderHeadlessJson, runHeadlessTurn } from "./runtime/headless.js";
import { restoreOrCreateSession, saveSession } from "./runtime/session-store.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import { loadConfig } from "./utils/config.js";
import { writeDebugLog } from "./utils/debug-log.js";

async function main(): Promise<void> {
  const parsedArgs = parseHeadlessArgs(process.argv.slice(2));
  if (parsedArgs.error) {
    process.stderr.write(`${parsedArgs.error}\n`);
    process.exitCode = 1;
    return;
  }

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

  if (parsedArgs.mode === "headless" && parsedArgs.options) {
    const result = await runHeadlessTurn({
      session,
      provider,
      imageProvider,
      registry,
      searchProvider,
      contextBuilder,
      cwd: process.cwd(),
      prompt: parsedArgs.options.prompt,
      yesSafe: parsedArgs.options.yesSafe,
      onSessionChange: () => saveSession(session, restoredSession.path)
    });

    if (parsedArgs.options.output === "json") {
      process.stdout.write(renderHeadlessJson(result));
    } else {
      process.stdout.write(result.content.endsWith("\n") ? result.content : `${result.content}\n`);
    }

    await saveSession(session, restoredSession.path);
    process.exitCode = result.exitCode;
    return;
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
