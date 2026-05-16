import { getOptionalString, getString, isRecord } from "./args.js";
import { toolFailure, type Tool } from "./types.js";

export function createSearchTools(): Tool[] {
  return [webSearchTool, xSearchTool];
}

const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the live web using xAI Responses API and return a concise summary with URL citations.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search question or topic."
      },
      allowedDomains: {
        type: "array",
        description: "Optional list of domains to restrict search to. Maximum 5.",
        items: { type: "string" }
      },
      excludedDomains: {
        type: "array",
        description: "Optional list of domains to exclude. Maximum 5.",
        items: { type: "string" }
      },
      enableImageUnderstanding: {
        type: "boolean",
        description: "Whether to analyze images encountered while browsing."
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  async execute(args, context) {
    const query = getString(args, "query");

    if (!query) {
      return toolFailure("web_search", "invalid_arguments", "web_search requires a string query.");
    }

    const allowedDomains = getOptionalStringArray(args, "allowedDomains");
    const excludedDomains = getOptionalStringArray(args, "excludedDomains");

    if (!allowedDomains.ok || !excludedDomains.ok) {
      return toolFailure("web_search", "invalid_arguments", "web_search domain filters must be arrays of strings.");
    }

    if (allowedDomains.value && excludedDomains.value) {
      return toolFailure("web_search", "invalid_arguments", "allowedDomains and excludedDomains cannot both be set.");
    }

    if ((allowedDomains.value?.length ?? 0) > 5 || (excludedDomains.value?.length ?? 0) > 5) {
      return toolFailure("web_search", "invalid_arguments", "web_search domain filters accept at most 5 domains.");
    }

    if (!context.searchProvider) {
      return toolFailure("web_search", "missing_api_key", "Search provider is unavailable. Check XAI_API_KEY configuration.");
    }

    return context.searchProvider.runWebSearch({
      query,
      ...(allowedDomains.value ? { allowedDomains: allowedDomains.value } : {}),
      ...(excludedDomains.value ? { excludedDomains: excludedDomains.value } : {}),
      ...(getBoolean(args, "enableImageUnderstanding") !== undefined
        ? { enableImageUnderstanding: getBoolean(args, "enableImageUnderstanding") }
        : {})
    });
  }
};

const xSearchTool: Tool = {
  name: "x_search",
  description: "Search X posts using xAI Responses API and return a concise summary with URL citations.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "X search question or topic."
      },
      allowedXHandles: {
        type: "array",
        description: "Optional X handles to restrict search to. Maximum 10.",
        items: { type: "string" }
      },
      excludedXHandles: {
        type: "array",
        description: "Optional X handles to exclude. Maximum 10.",
        items: { type: "string" }
      },
      fromDate: {
        type: "string",
        description: "Optional start date in YYYY-MM-DD format."
      },
      toDate: {
        type: "string",
        description: "Optional end date in YYYY-MM-DD format."
      },
      enableImageUnderstanding: {
        type: "boolean",
        description: "Whether to analyze images in X posts."
      },
      enableVideoUnderstanding: {
        type: "boolean",
        description: "Whether to analyze videos in X posts."
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  async execute(args, context) {
    const query = getString(args, "query");

    if (!query) {
      return toolFailure("x_search", "invalid_arguments", "x_search requires a string query.");
    }

    const allowedXHandles = getOptionalStringArray(args, "allowedXHandles");
    const excludedXHandles = getOptionalStringArray(args, "excludedXHandles");
    const fromDate = getOptionalString(args, "fromDate");
    const toDate = getOptionalString(args, "toDate");

    if (!allowedXHandles.ok || !excludedXHandles.ok) {
      return toolFailure("x_search", "invalid_arguments", "x_search handle filters must be arrays of strings.");
    }

    if (allowedXHandles.value && excludedXHandles.value) {
      return toolFailure("x_search", "invalid_arguments", "allowedXHandles and excludedXHandles cannot both be set.");
    }

    if ((allowedXHandles.value?.length ?? 0) > 10 || (excludedXHandles.value?.length ?? 0) > 10) {
      return toolFailure("x_search", "invalid_arguments", "x_search handle filters accept at most 10 handles.");
    }

    if ((fromDate && !isIsoDate(fromDate)) || (toDate && !isIsoDate(toDate))) {
      return toolFailure("x_search", "invalid_arguments", "fromDate and toDate must use YYYY-MM-DD format.");
    }

    if (!context.searchProvider) {
      return toolFailure("x_search", "missing_api_key", "Search provider is unavailable. Check XAI_API_KEY configuration.");
    }

    return context.searchProvider.runXSearch({
      query,
      ...(allowedXHandles.value ? { allowedXHandles: allowedXHandles.value } : {}),
      ...(excludedXHandles.value ? { excludedXHandles: excludedXHandles.value } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(getBoolean(args, "enableImageUnderstanding") !== undefined
        ? { enableImageUnderstanding: getBoolean(args, "enableImageUnderstanding") }
        : {}),
      ...(getBoolean(args, "enableVideoUnderstanding") !== undefined
        ? { enableVideoUnderstanding: getBoolean(args, "enableVideoUnderstanding") }
        : {})
    });
  }
};

function getOptionalStringArray(args: unknown, key: string): { ok: true; value?: string[] } | { ok: false } {
  if (!isRecord(args)) {
    return { ok: true };
  }

  const value = args[key];

  if (value === undefined) {
    return { ok: true };
  }

  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? { ok: true, value }
    : { ok: false };
}

function getBoolean(args: unknown, key: string): boolean | undefined {
  if (!isRecord(args)) {
    return undefined;
  }

  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
