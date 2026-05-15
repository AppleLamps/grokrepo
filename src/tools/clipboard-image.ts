import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { runFileCommand, type CommandResult } from "./process.js";
import { toWorkspaceRelativePath } from "./path.js";
import { toolFailure, toolSuccess, type ToolExecutionResult } from "./types.js";

const IMAGE_DIRECTORY = ".workspace/images";

export interface ClipboardCaptureOptions {
  fileName?: string;
  now?: () => Date;
  platform?: NodeJS.Platform;
  runCommand?: typeof runFileCommand;
}

export interface ClipboardImageOutput {
  path: string;
  bytes: number;
  platform: NodeJS.Platform;
}

export async function captureClipboardImage(
  cwd: string,
  options: ClipboardCaptureOptions = {}
): Promise<ToolExecutionResult<ClipboardImageOutput>> {
  const platform = options.platform ?? process.platform;

  if (platform !== "win32") {
    return clipboardImageFailure(
      "capture_clipboard_image",
      "unsupported_platform",
      "Native clipboard image capture is currently implemented for Windows only."
    );
  }

  const outputDirectory = path.join(cwd, IMAGE_DIRECTORY);
  const outputPath = path.join(outputDirectory, options.fileName ?? createClipboardFileName(options.now?.() ?? new Date()));
  const runCommand = options.runCommand ?? runFileCommand;

  await mkdir(outputDirectory, { recursive: true });

  const result = await runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShellCommand(clipboardCaptureScript(outputPath))
    ],
    { cwd, timeoutMs: 30_000 }
  );

  if (result.exitCode !== 0) {
    return clipboardFailure(result);
  }

  try {
    const imageStat = await stat(outputPath);

    return toolSuccess("capture_clipboard_image", {
      path: toWorkspaceRelativePath(cwd, outputPath),
      bytes: imageStat.size,
      platform
    });
  } catch (cause) {
    return clipboardImageFailure(
      "capture_clipboard_image",
      "clipboard_capture_failed",
      cause instanceof Error ? cause.message : String(cause)
    );
  }
}

function clipboardFailure(result: CommandResult): ToolExecutionResult<ClipboardImageOutput> {
  const message = `${result.stderr}\n${result.stdout}`.trim();

  if (message.includes("clipboard_no_image")) {
    return clipboardImageFailure("capture_clipboard_image", "clipboard_empty", "The Windows clipboard does not contain an image.");
  }

  return clipboardImageFailure(
    "capture_clipboard_image",
    "clipboard_capture_failed",
    message.length > 0 ? message : `Clipboard capture exited with code ${result.exitCode}.`,
    { exitCode: result.exitCode }
  );
}

function clipboardImageFailure(
  tool: string,
  code: string,
  message: string,
  metadata?: Record<string, unknown>
): ToolExecutionResult<ClipboardImageOutput> {
  return toolFailure(tool, code, message, metadata) as ToolExecutionResult<ClipboardImageOutput>;
}

function clipboardCaptureScript(outputPath: string): string {
  const escapedOutputPath = escapePowerShellSingleQuoted(outputPath);

  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    `$outputPath = '${escapedOutputPath}'`,
    "$outputDirectory = [System.IO.Path]::GetDirectoryName($outputPath)",
    "[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null",
    "$image = [System.Windows.Forms.Clipboard]::GetImage()",
    "if ($null -eq $image) { [Console]::Error.WriteLine('clipboard_no_image'); exit 3 }",
    "try { $image.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $image.Dispose() }",
    "[Console]::Out.WriteLine($outputPath)"
  ].join("\n");
}

function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, "utf16le").toString("base64");
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replaceAll("'", "''");
}

function createClipboardFileName(now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-clipboard.png`;
}
