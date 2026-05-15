import { config as loadDotenv } from "dotenv";

import { parseThemeMode, type ThemeMode } from "../cli/theme.js";

export interface AppConfig {
  apiKey?: string;
  apiKeySource?: "XAI_API_KEY" | "GROK_API_KEY";
  baseUrl: string;
  model: string;
  imageModel: string;
  uiTheme?: ThemeMode;
  debug?: boolean;
  mock: boolean;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function loadConfig(): AppConfig {
  loadDotenv({ quiet: true, override: true });

  const xaiApiKey = process.env.XAI_API_KEY;
  const grokApiKey = process.env.GROK_API_KEY;
  const apiKey = xaiApiKey ?? grokApiKey;

  return {
    apiKey,
    apiKeySource: xaiApiKey ? "XAI_API_KEY" : grokApiKey ? "GROK_API_KEY" : undefined,
    baseUrl: process.env.GROK_BASE_URL ?? "https://api.x.ai/v1",
    model: process.env.GROK_MODEL ?? "grok-4.3",
    imageModel: process.env.GROK_IMAGE_MODEL ?? "grok-imagine-image-quality",
    uiTheme: parseThemeMode(process.env.GROKCODE_THEME),
    debug: TRUE_VALUES.has((process.env.GROKCODE_DEBUG ?? "").toLowerCase()),
    mock: TRUE_VALUES.has((process.env.GROKCODE_MOCK ?? "").toLowerCase())
  };
}
