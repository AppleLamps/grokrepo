import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getOptionalString, getString } from "./args.js";
import { resolveWorkspacePath, toWorkspaceRelativePath } from "./path.js";
import { toolFailure, type Tool } from "./types.js";

const IMAGE_DIRECTORY = ".workspace/images";
const ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "auto"]);
const RESOLUTIONS = new Set(["1k", "2k"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function createImageTools(): Tool[] {
  return [imageGenerateTool, imageUnderstandTool];
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

    if (imageUrl) {
      return context.imageProvider.understandImage({
        prompt,
        imageUrl,
        source: {
          type: "url"
        }
      });
    }

    const resolved = resolveWorkspacePath(context.cwd, requestedPath ?? "");
    if (!resolved.ok) {
      return toolFailure("image_understand", "path_outside_workspace", resolved.error);
    }

    try {
      const fileStat = await stat(resolved.path);
      if (!fileStat.isFile()) {
        return toolFailure("image_understand", "invalid_image", "Image path must point to a file.");
      }

      if (fileStat.size > MAX_IMAGE_BYTES) {
        return toolFailure("image_understand", "image_too_large", "Image files over 20MB are not supported in Phase 5.");
      }

      const buffer = await readFile(resolved.path);
      const mime = mimeTypeForPath(resolved.path);

      if (!mime) {
        return toolFailure("image_understand", "unsupported_image_type", "Supported image types are PNG, JPEG, WebP, and GIF.");
      }

      return context.imageProvider.understandImage({
        prompt,
        imageUrl: `data:${mime};base64,${buffer.toString("base64")}`,
        source: {
          type: "file",
          path: toWorkspaceRelativePath(context.cwd, resolved.path),
          size: fileStat.size
        }
      });
    } catch (cause) {
      return toolFailure("image_understand", "image_read_failed", cause instanceof Error ? cause.message : String(cause));
    }
  }
};

function getOptionalNumber(args: unknown, key: string): number | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }

  const value = (args as Record<string, unknown>)[key];
  return value === undefined || typeof value === "number" ? value : undefined;
}

function mimeTypeForPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  return undefined;
}
