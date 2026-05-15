import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveWorkspacePath, toWorkspaceRelativePath } from "./path.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface NormalizedImageSource {
  imageUrl: string;
  source: {
    type: "url" | "file" | "data_uri";
    path?: string;
    size?: number;
  };
}

export async function normalizeImageSource(
  cwd: string,
  input: string
): Promise<{ ok: true; value: NormalizedImageSource } | { ok: false; code: string; message: string }> {
  const normalized = normalizeImageInput(input);

  if (normalized.length === 0) {
    return {
      ok: false,
      code: "invalid_image_source",
      message: "Image source cannot be empty."
    };
  }

  if (isDataImageUri(normalized)) {
    return {
      ok: true,
      value: {
        imageUrl: normalized,
        source: {
          type: "data_uri"
        }
      }
    };
  }

  if (isHttpUrl(normalized)) {
    return {
      ok: true,
      value: {
        imageUrl: normalized,
        source: {
          type: "url"
        }
      }
    };
  }

  const resolved = resolveWorkspacePath(cwd, normalized);
  if (!resolved.ok) {
    return {
      ok: false,
      code: "path_outside_workspace",
      message: resolved.error
    };
  }

  try {
    const fileStat = await stat(resolved.path);

    if (!fileStat.isFile()) {
      return {
        ok: false,
        code: "invalid_image",
        message: "Image path must point to a file."
      };
    }

    if (fileStat.size > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        code: "image_too_large",
        message: "Image files over 20MB are not supported in Phase 5."
      };
    }

    const mime = mimeTypeForPath(resolved.path);

    if (!mime) {
      return {
        ok: false,
        code: "unsupported_image_type",
        message: "Supported image types are PNG, JPEG, WebP, and GIF."
      };
    }

    const buffer = await readFile(resolved.path);

    return {
      ok: true,
      value: {
        imageUrl: `data:${mime};base64,${buffer.toString("base64")}`,
        source: {
          type: "file",
          path: toWorkspaceRelativePath(cwd, resolved.path),
          size: fileStat.size
        }
      }
    };
  } catch (cause) {
    return {
      ok: false,
      code: "image_read_failed",
      message: cause instanceof Error ? cause.message : String(cause)
    };
  }
}

export function normalizeImageInput(input: string): string {
  let value = input.trim();

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (value.startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return value;
    }
  }

  return value;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isDataImageUri(value: string): boolean {
  return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(value);
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
