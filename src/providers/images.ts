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

export interface ImageUnderstandingRequest {
  prompt: string;
  imageUrl: string;
  source: {
    type: "url" | "file";
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
}

function createImageFileName(prompt: string, index: number): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${stamp}-${slug}-${index + 1}.jpg`;
}

function imageFailure<TOutput>(tool: string, code: string, message: string): ToolExecutionResult<TOutput> {
  return toolFailure(tool, code, message) as ToolExecutionResult<TOutput>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
