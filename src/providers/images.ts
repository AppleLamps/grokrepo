import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ImagesResponse } from "openai/resources/images";

import { toolFailure, toolSuccess, type ToolExecutionResult } from "../tools/types.js";
import type { AppConfig } from "../utils/config.js";

export interface ImageGenerationRequest {
  prompt: string;
  count?: number;
  aspectRatio?: string;
  resolution?: "1k" | "2k";
  outputDirectory: string;
}

export interface GeneratedImage {
  path: string;
  bytes: number;
  index: number;
  model?: string;
}

export interface ImageGenerationOutput {
  prompt: string;
  model: string;
  images: GeneratedImage[];
}

export interface ImageEditRequest {
  prompt: string;
  images: Array<{
    imageUrl: string;
    source: {
      type: "url" | "file" | "data_uri";
      path?: string;
      size?: number;
    };
  }>;
  aspectRatio?: string;
  resolution?: "1k" | "2k";
  outputDirectory: string;
}

export interface ImageEditOutput extends ImageGenerationOutput {
  sources: ImageEditRequest["images"][number]["source"][];
}

export interface ImageUnderstandingRequest {
  prompt: string;
  imageUrl: string;
  source: {
    type: "url" | "file" | "data_uri";
    path?: string;
    size?: number;
  };
}

export interface ImageUnderstandingOutput {
  prompt: string;
  summary: string;
  source: ImageUnderstandingRequest["source"];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export class ImageProvider {
  private readonly client?: OpenAI;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;

    if (!config.mock && config.apiKey) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: 360_000
      });
    }
  }

  async generateImage(args: unknown): Promise<ToolExecutionResult<ImageGenerationOutput>> {
    const request = args as ImageGenerationRequest;

    if (!this.client) {
      return imageFailure("image_generate", "missing_api_key", "Missing XAI_API_KEY. Add it to .env before generating images.");
    }

    try {
      await mkdir(request.outputDirectory, { recursive: true });

      const response = await this.client.images.generate({
        model: this.config.imageModel,
        prompt: request.prompt,
        n: request.count ?? 1,
        response_format: "b64_json",
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {})
      } as never) as ImagesResponse;

      const images: GeneratedImage[] = [];

      for (const [index, image] of (response.data ?? []).entries()) {
        if (!image.b64_json) {
          continue;
        }

        const bytes = Buffer.from(image.b64_json, "base64");
        const fileName = createImageFileName(request.prompt, index);
        const absolutePath = path.join(request.outputDirectory, fileName);
        await writeFile(absolutePath, bytes);

        images.push({
          path: absolutePath,
          bytes: bytes.byteLength,
          index,
          model: (image as { model?: string }).model
        });
      }

      if (images.length === 0) {
        return imageFailure("image_generate", "empty_response", "Image generation returned no image data.");
      }

      return toolSuccess("image_generate", {
        prompt: request.prompt,
        model: this.config.imageModel,
        images
      });
    } catch (cause) {
      return imageFailure("image_generate", "image_generation_failed", errorMessage(cause));
    }
  }

  async understandImage(args: unknown): Promise<ToolExecutionResult<ImageUnderstandingOutput>> {
    const request = args as ImageUnderstandingRequest;

    if (!this.client) {
      return imageFailure("image_understand", "missing_api_key", "Missing XAI_API_KEY. Add it to .env before analyzing images.");
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: request.prompt },
              { type: "image_url", image_url: { url: request.imageUrl } }
            ]
          }
        ]
      } as never) as ChatCompletion;

      const summary = response.choices[0]?.message.content?.trim() ?? "";

      return toolSuccess("image_understand", {
        prompt: request.prompt,
        summary: summary.length > 0 ? summary : "Image analysis returned no summary.",
        source: request.source,
        ...(response.usage
          ? {
              usage: {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens
              }
            }
          : {})
      });
    } catch (cause) {
      return imageFailure("image_understand", "image_understanding_failed", errorMessage(cause));
    }
  }

  async editImage(args: unknown): Promise<ToolExecutionResult<ImageEditOutput>> {
    const request = args as ImageEditRequest;

    if (!this.config.apiKey) {
      return imageFailure("image_edit", "missing_api_key", "Missing XAI_API_KEY. Add it to .env before editing images.");
    }

    try {
      await mkdir(request.outputDirectory, { recursive: true });

      const response = await fetch(buildUrl(this.config.baseUrl, "images/edits"), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildImageEditBody(this.config.imageModel, request))
      });

      if (!response.ok) {
        return imageFailure("image_edit", "image_edit_failed", `${response.status} ${await response.text()}`);
      }

      const body = await response.json() as ImagesResponse;
      const images = await saveImageResponse(body, request.outputDirectory, request.prompt);

      if (images.length === 0) {
        return imageFailure("image_edit", "empty_response", "Image edit returned no image data.");
      }

      return toolSuccess("image_edit", {
        prompt: request.prompt,
        model: this.config.imageModel,
        images,
        sources: request.images.map((image) => image.source)
      });
    } catch (cause) {
      return imageFailure("image_edit", "image_edit_failed", errorMessage(cause));
    }
  }
}

export function buildImageEditBody(model: string, request: ImageEditRequest): Record<string, unknown> {
  const imagePayload = request.images.map((image) => ({
    url: image.imageUrl,
    type: "image_url"
  }));

  return {
    model,
    prompt: request.prompt,
    image: imagePayload.length === 1 ? imagePayload[0] : imagePayload,
    response_format: "b64_json",
    ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
    ...(request.resolution ? { resolution: request.resolution } : {})
  };
}

function buildUrl(baseUrl: string, endpoint: string): string {
  return new URL(endpoint, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

async function saveBase64Images(response: ImagesResponse, outputDirectory: string, prompt: string): Promise<GeneratedImage[]> {
  return saveImageResponse(response, outputDirectory, prompt, { allowUrlDownload: false });
}

async function saveImageResponse(
  response: ImagesResponse,
  outputDirectory: string,
  prompt: string,
  options: { allowUrlDownload?: boolean } = { allowUrlDownload: true }
): Promise<GeneratedImage[]> {
  const images: GeneratedImage[] = [];

  for (const [index, image] of (response.data ?? []).entries()) {
    const item = image as { b64_json?: string; url?: string; model?: string };
    const saved = item.b64_json
      ? await saveBase64Image(item.b64_json, outputDirectory, prompt, index)
      : options.allowUrlDownload && item.url
        ? await saveRemoteImage(item.url, outputDirectory, prompt, index)
        : undefined;

    if (!saved) {
      continue;
    }

    images.push({
      path: saved.path,
      bytes: saved.bytes,
      index,
      model: item.model
    });
  }

  return images;
}

async function saveBase64Image(
  base64: string,
  outputDirectory: string,
  prompt: string,
  index: number,
  extension = "jpg"
): Promise<{ path: string; bytes: number }> {
  const bytes = Buffer.from(base64, "base64");
  const absolutePath = path.join(outputDirectory, createImageFileName(prompt, index, extension));
  await writeFile(absolutePath, bytes);

  return {
    path: absolutePath,
    bytes: bytes.byteLength
  };
}

async function saveRemoteImage(url: string, outputDirectory: string, prompt: string, index: number): Promise<{ path: string; bytes: number }> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download edited image: ${response.status} ${await response.text()}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const extension = extensionFromContentType(contentType);
  const bytes = Buffer.from(await response.arrayBuffer());
  const absolutePath = path.join(outputDirectory, createImageFileName(prompt, index, extension));
  await writeFile(absolutePath, bytes);

  return {
    path: absolutePath,
    bytes: bytes.byteLength
  };
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes("png")) {
    return "png";
  }

  if (contentType.includes("webp")) {
    return "webp";
  }

  if (contentType.includes("gif")) {
    return "gif";
  }

  return "jpg";
}

function createImageFileName(prompt: string, index: number, extension = "jpg"): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${stamp}-${slug}-${index + 1}.${extension}`;
}

function imageFailure<TOutput>(tool: string, code: string, message: string): ToolExecutionResult<TOutput> {
  return toolFailure(tool, code, message) as ToolExecutionResult<TOutput>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
