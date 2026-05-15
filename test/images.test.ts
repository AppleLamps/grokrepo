import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ImageProvider } from "../src/providers/images.js";
import { createDefaultToolRegistry } from "../src/tools/index.js";
import { toolSuccess, type ImageProviderLike } from "../src/tools/types.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

test("image tools are registered with expected permissions", () => {
  const registry = createDefaultToolRegistry();

  assert.equal(registry.get("image_generate")?.permission, "active");
  assert.equal(registry.get("image_understand")?.permission, "passive");
});

test("image_generate validates count and resolution", async () => {
  const tool = createDefaultToolRegistry().get("image_generate");
  assert.ok(tool);

  const badCount = await tool.execute(
    { prompt: "asset", count: 11 },
    { cwd: process.cwd(), imageProvider: createImageProvider() }
  );
  const badResolution = await tool.execute(
    { prompt: "asset", resolution: "4k" },
    { cwd: process.cwd(), imageProvider: createImageProvider() }
  );

  assert.equal(badCount.ok, false);
  assert.equal(badCount.error?.code, "invalid_arguments");
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.error?.code, "invalid_arguments");
});

test("image_generate passes workspace image output directory", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  const tool = createDefaultToolRegistry().get("image_generate");
  assert.ok(tool);

  let outputDirectory = "";
  const imageProvider: ImageProviderLike = {
    async generateImage(args) {
      outputDirectory = (args as { outputDirectory: string }).outputDirectory;
      return toolSuccess("image_generate", {
        prompt: "asset",
        model: "grok-imagine-image-quality",
        images: []
      });
    },
    async understandImage() {
      return toolSuccess("image_understand", {});
    }
  };

  await tool.execute({ prompt: "asset" }, { cwd, imageProvider });

  assert.equal(outputDirectory, path.join(cwd, ".workspace/images"));
});

test("image_understand validates exactly one image source", async () => {
  const tool = createDefaultToolRegistry().get("image_understand");
  assert.ok(tool);

  const missing = await tool.execute({}, { cwd: process.cwd(), imageProvider: createImageProvider() });
  const both = await tool.execute(
    { path: "a.png", imageUrl: "https://example.com/a.png" },
    { cwd: process.cwd(), imageProvider: createImageProvider() }
  );

  assert.equal(missing.ok, false);
  assert.equal(missing.error?.code, "invalid_arguments");
  assert.equal(both.ok, false);
  assert.equal(both.error?.code, "invalid_arguments");
});

test("image_understand encodes local image files", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  await writeFile(path.join(cwd, "pixel.png"), ONE_PIXEL_PNG);

  const tool = createDefaultToolRegistry().get("image_understand");
  assert.ok(tool);

  let imageUrl = "";
  const imageProvider: ImageProviderLike = {
    async generateImage() {
      return toolSuccess("image_generate", {});
    },
    async understandImage(args) {
      imageUrl = (args as { imageUrl: string }).imageUrl;
      return toolSuccess("image_understand", {
        prompt: "describe",
        summary: "pixel",
        source: { type: "file", path: "pixel.png", size: ONE_PIXEL_PNG.byteLength }
      });
    }
  };

  const result = await tool.execute({ path: "pixel.png", prompt: "describe" }, { cwd, imageProvider });

  assert.equal(result.ok, true);
  assert.equal(imageUrl.startsWith("data:image/png;base64,"), true);
});

test("image_understand rejects paths outside workspace", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  const tool = createDefaultToolRegistry().get("image_understand");
  assert.ok(tool);

  const result = await tool.execute({ path: "../outside.png" }, { cwd, imageProvider: createImageProvider() });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_outside_workspace");
});

test("ImageProvider returns missing_api_key when API key is absent", async () => {
  const provider = new ImageProvider({
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    imageModel: "grok-imagine-image-quality",
    mock: false
  });

  const result = await provider.generateImage({
    prompt: "asset",
    outputDirectory: path.join(os.tmpdir(), "grokcode-images")
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "missing_api_key");
});

test("ImageProvider writes generated base64 images", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  const provider = new ImageProvider({
    apiKey: "test",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    imageModel: "grok-imagine-image-quality",
    mock: false
  });

  const client = provider as unknown as {
    client: {
      images: {
        generate: () => Promise<{ data: Array<{ b64_json: string; model?: string }> }>;
      };
    };
  };
  client.client = {
    images: {
      async generate() {
        return {
          data: [
            {
              b64_json: ONE_PIXEL_PNG.toString("base64"),
              model: "grok-imagine-image-quality"
            }
          ]
        };
      }
    }
  };

  const result = await provider.generateImage({
    prompt: "test image",
    outputDirectory
  });

  assert.equal(result.ok, true);
  const image = result.output?.images[0];
  assert.ok(image);
  assert.equal(await readFile(image.path).then((content) => content.equals(ONE_PIXEL_PNG)), true);
});

function createImageProvider(): ImageProviderLike {
  return {
    async generateImage() {
      return toolSuccess("image_generate", {
        prompt: "asset",
        model: "grok-imagine-image-quality",
        images: []
      });
    },
    async understandImage() {
      return toolSuccess("image_understand", {
        prompt: "describe",
        summary: "summary",
        source: { type: "url" }
      });
    }
  };
}
