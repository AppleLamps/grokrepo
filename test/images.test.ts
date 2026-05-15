import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildImageEditBody, ImageProvider } from "../src/providers/images.js";
import { normalizeImageInput, normalizeImageSource } from "../src/tools/image-source.js";
import { createDefaultToolRegistry } from "../src/tools/index.js";
import { toolSuccess, type ImageProviderLike } from "../src/tools/types.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

test("image tools are registered with expected permissions", () => {
  const registry = createDefaultToolRegistry();

  assert.equal(registry.get("image_generate")?.permission, "active");
  assert.equal(registry.get("image_edit")?.permission, "active");
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
    async editImage() {
      return toolSuccess("image_edit", {});
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
    async editImage() {
      return toolSuccess("image_edit", {});
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

test("image_edit validates one to three images", async () => {
  const tool = createDefaultToolRegistry().get("image_edit");
  assert.ok(tool);

  const missing = await tool.execute({ prompt: "edit", images: [] }, { cwd: process.cwd(), imageProvider: createImageProvider() });
  const tooMany = await tool.execute(
    { prompt: "edit", images: ["a.png", "b.png", "c.png", "d.png"] },
    { cwd: process.cwd(), imageProvider: createImageProvider() }
  );

  assert.equal(missing.ok, false);
  assert.equal(missing.error?.code, "invalid_arguments");
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error?.code, "invalid_arguments");
});

test("image_edit accepts local paths, URLs, and data URIs", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  await writeFile(path.join(cwd, "pixel.png"), ONE_PIXEL_PNG);
  const tool = createDefaultToolRegistry().get("image_edit");
  assert.ok(tool);

  let images: Array<{ imageUrl: string; source: { type: string } }> = [];
  const imageProvider: ImageProviderLike = {
    async generateImage() {
      return toolSuccess("image_generate", {});
    },
    async editImage(args) {
      images = (args as { images: Array<{ imageUrl: string; source: { type: string } }> }).images;
      return toolSuccess("image_edit", {
        prompt: "edit",
        model: "grok-imagine-image-quality",
        images: [],
        sources: images.map((image) => image.source)
      });
    },
    async understandImage() {
      return toolSuccess("image_understand", {});
    }
  };

  const result = await tool.execute(
    {
      prompt: "edit",
      images: ["pixel.png", "https://example.com/source.png", `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`]
    },
    { cwd, imageProvider }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(images.map((image) => image.source.type), ["file", "url", "data_uri"]);
});

test("image_edit rejects unsupported types and paths outside workspace", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  await writeFile(path.join(cwd, "note.txt"), "not image", "utf8");
  const tool = createDefaultToolRegistry().get("image_edit");
  assert.ok(tool);

  const unsupported = await tool.execute({ prompt: "edit", images: ["note.txt"] }, { cwd, imageProvider: createImageProvider() });
  const outside = await tool.execute({ prompt: "edit", images: ["../outside.png"] }, { cwd, imageProvider: createImageProvider() });

  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error?.code, "unsupported_image_type");
  assert.equal(outside.ok, false);
  assert.equal(outside.error?.code, "path_outside_workspace");
});

test("normalizeImageSource handles quoted paths and file URLs", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  const imagePath = path.join(cwd, "pixel.png");
  await writeFile(imagePath, ONE_PIXEL_PNG);

  assert.equal(normalizeImageInput(`"${imagePath}"`), imagePath);

  const fileUrl = new URL(`file:///${imagePath.replaceAll("\\", "/")}`).toString();
  const result = await normalizeImageSource(cwd, fileUrl);

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.source.type : "", "file");
});

test("buildImageEditBody uses xAI JSON image edit shape", () => {
  const body = buildImageEditBody("grok-imagine-image-quality", {
    prompt: "make it blue",
    outputDirectory: ".workspace/images",
    aspectRatio: "1:1",
    resolution: "1k",
    images: [
      {
        imageUrl: "data:image/png;base64,abc",
        source: { type: "data_uri" }
      }
    ]
  });

  assert.deepEqual(body, {
    model: "grok-imagine-image-quality",
    prompt: "make it blue",
    image: {
      url: "data:image/png;base64,abc",
      type: "image_url"
    },
    response_format: "b64_json",
    aspect_ratio: "1:1",
    resolution: "1k"
  });
});

test("ImageProvider writes edited base64 images from direct JSON request", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  const provider = new ImageProvider({
    apiKey: "test",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    imageModel: "grok-imagine-image-quality",
    mock: false
  });
  const originalFetch = globalThis.fetch;
  let requestBody = "";

  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body);
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: ONE_PIXEL_PNG.toString("base64"),
            model: "grok-imagine-image-quality"
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await provider.editImage({
      prompt: "make it blue",
      outputDirectory,
      images: [{ imageUrl: "data:image/png;base64,abc", source: { type: "data_uri" } }]
    });

    assert.equal(result.ok, true);
    assert.match(requestBody, /"image"/);
    const image = result.output?.images[0];
    assert.ok(image);
    assert.equal(await readFile(image.path).then((content) => content.equals(ONE_PIXEL_PNG)), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ImageProvider downloads edited URL image responses", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "grokcode-images-"));
  const provider = new ImageProvider({
    apiKey: "test",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    imageModel: "grok-imagine-image-quality",
    mock: false
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/images/edits")) {
      return new Response(
        JSON.stringify({
          data: [{ url: "https://cdn.example.test/edited.png", model: "grok-imagine-image-quality" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
  };

  try {
    const result = await provider.editImage({
      prompt: "make it blue",
      outputDirectory,
      images: [{ imageUrl: "data:image/png;base64,abc", source: { type: "data_uri" } }]
    });

    assert.equal(result.ok, true);
    const image = result.output?.images[0];
    assert.ok(image);
    assert.match(image.path, /\.png$/);
    assert.equal(await readFile(image.path).then((content) => content.equals(ONE_PIXEL_PNG)), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    async editImage() {
      return toolSuccess("image_edit", {
        prompt: "edit",
        model: "grok-imagine-image-quality",
        images: [],
        sources: []
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
