import path from "node:path";

import { getOptionalString, getString } from "./args.js";
import { captureClipboardImage } from "./clipboard-image.js";
import { normalizeImageSource } from "./image-source.js";
import { toolFailure, type Tool } from "./types.js";

const IMAGE_DIRECTORY = ".workspace/images";
const ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "auto"]);
const RESOLUTIONS = new Set(["1k", "2k"]);

export function createImageTools(): Tool[] {
  return [imageGenerateTool, imageEditTool, imageUnderstandTool, captureClipboardImageTool];
}

const imageGenerateTool: Tool = {
  name: "image_generate",
  description: "Generate image assets with Grok Imagine and save them under .workspace/images after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Detailed prompt for the generated image."
      },
      count: {
        type: "number",
        description: "Number of images to generate. Defaults to 1. Maximum 10."
      },
      aspectRatio: {
        type: "string",
        description: "Optional aspect ratio, such as 1:1, 16:9, 9:16, or auto."
      },
      resolution: {
        type: "string",
        description: "Optional output resolution. Supported values are 1k and 2k."
      }
    },
    required: ["prompt"],
    additionalProperties: false
  },
  async execute(args, context) {
    const prompt = getString(args, "prompt");

    if (!prompt) {
      return toolFailure("image_generate", "invalid_arguments", "image_generate requires a string prompt.");
    }

    const count = getOptionalNumber(args, "count") ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      return toolFailure("image_generate", "invalid_arguments", "count must be an integer from 1 to 10.");
    }

    const aspectRatio = getOptionalString(args, "aspectRatio");
    if (aspectRatio && !ASPECT_RATIOS.has(aspectRatio)) {
      return toolFailure("image_generate", "invalid_arguments", "Unsupported aspectRatio.");
    }

    const resolution = getOptionalString(args, "resolution");
    if (resolution && !RESOLUTIONS.has(resolution)) {
      return toolFailure("image_generate", "invalid_arguments", "resolution must be 1k or 2k.");
    }

    if (!context.imageProvider) {
      return toolFailure("image_generate", "missing_api_key", "Image provider is unavailable. Check XAI_API_KEY configuration.");
    }

    return context.imageProvider.generateImage({
      prompt,
      count,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      outputDirectory: path.join(context.cwd, IMAGE_DIRECTORY)
    });
  }
};

const imageEditTool: Tool = {
  name: "image_edit",
  description: "Edit one to three source images with Grok Imagine and save results under .workspace/images after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Natural language edit instruction."
      },
      images: {
        type: "array",
        description: "One to three image sources. Each source can be a workspace path, public URL, file URL, or image data URI.",
        items: { type: "string" }
      },
      aspectRatio: {
        type: "string",
        description: "Optional output aspect ratio for multi-image edits, such as 1:1, 16:9, 9:16, or auto."
      },
      resolution: {
        type: "string",
        description: "Optional output resolution. Supported values are 1k and 2k."
      }
    },
    required: ["prompt", "images"],
    additionalProperties: false
  },
  async execute(args, context) {
    const prompt = getString(args, "prompt");
    const images = getStringArray(args, "images");

    if (!prompt || !images) {
      return toolFailure("image_edit", "invalid_arguments", "image_edit requires string prompt and images array.");
    }

    if (images.length < 1 || images.length > 3) {
      return toolFailure("image_edit", "invalid_arguments", "image_edit requires one to three source images.");
    }

    const aspectRatio = getOptionalString(args, "aspectRatio");
    if (aspectRatio && !ASPECT_RATIOS.has(aspectRatio)) {
      return toolFailure("image_edit", "invalid_arguments", "Unsupported aspectRatio.");
    }

    const resolution = getOptionalString(args, "resolution");
    if (resolution && !RESOLUTIONS.has(resolution)) {
      return toolFailure("image_edit", "invalid_arguments", "resolution must be 1k or 2k.");
    }

    if (!context.imageProvider) {
      return toolFailure("image_edit", "missing_api_key", "Image provider is unavailable. Check XAI_API_KEY configuration.");
    }

    const normalizedImages = [];

    for (const image of images) {
      const normalized = await normalizeImageSource(context.cwd, image);

      if (!normalized.ok) {
        return toolFailure("image_edit", normalized.code, normalized.message);
      }

      normalizedImages.push(normalized.value);
    }

    return context.imageProvider.editImage({
      prompt,
      images: normalizedImages,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      outputDirectory: path.join(context.cwd, IMAGE_DIRECTORY)
    });
  }
};

const imageUnderstandTool: Tool = {
  name: "image_understand",
  description: "Analyze a local image file or public image URL with Grok vision and return a concise summary.",
  permission: "passive",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative local image path to analyze."
      },
      imageUrl: {
        type: "string",
        description: "Public image URL or data URI to analyze."
      },
      prompt: {
        type: "string",
        description: "Analysis instruction. Defaults to a concise visual description."
      }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const requestedPath = getOptionalString(args, "path");
    const imageUrl = getOptionalString(args, "imageUrl");
    const prompt = getOptionalString(args, "prompt") ?? "Analyze this image concisely for engineering and UI-relevant details.";

    if ((requestedPath && imageUrl) || (!requestedPath && !imageUrl)) {
      return toolFailure("image_understand", "invalid_arguments", "Provide exactly one of path or imageUrl.");
    }

    if (!context.imageProvider) {
      return toolFailure("image_understand", "missing_api_key", "Image provider is unavailable. Check XAI_API_KEY configuration.");
    }

    const normalized = await normalizeImageSource(context.cwd, imageUrl ?? requestedPath ?? "");

    if (!normalized.ok) {
      return toolFailure("image_understand", normalized.code, normalized.message);
    }

    return context.imageProvider.understandImage({
      prompt,
      imageUrl: normalized.value.imageUrl,
      source: normalized.value.source
    });
  }
};

const captureClipboardImageTool: Tool = {
  name: "capture_clipboard_image",
  description: "Capture a native Windows clipboard image and save it under .workspace/images after approval.",
  permission: "active",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    return captureClipboardImage(context.cwd);
  }
};

function getOptionalNumber(args: unknown, key: string): number | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }

  const value = (args as Record<string, unknown>)[key];
  return value === undefined || typeof value === "number" ? value : undefined;
}

function getStringArray(args: unknown, key: string): string[] | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }

  const value = (args as Record<string, unknown>)[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}
