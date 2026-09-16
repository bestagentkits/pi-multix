/**
 * `multix_media` — local media processing through ffmpeg and ImageMagick.
 *
 * These actions never call a provider API, so no key is required. They need
 * ffmpeg or ImageMagick on PATH; `multix_check` reports whether they are present.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { buildVariantArgs, CommonFields, defineMultixTool, type CommandVariant } from "./shared.js";

type Action = "optimize" | "split" | "batch";

const parameters = Type.Object({
  action: StringEnum(["optimize", "split", "batch"] as const, {
    description:
      "optimize compresses or resizes one file. split cuts one video into chunks. batch optimizes every file in a directory.",
  }),
  input: Type.Optional(Type.String({ description: "Input file for action=optimize or action=split." })),
  output: Type.Optional(
    Type.String({ description: "Output file for action=optimize. Required, and must differ from input." }),
  ),
  inputDir: Type.Optional(Type.String({ description: "Input directory for action=batch." })),
  outputDir: Type.Optional(
    Type.String({ description: "Output directory for action=batch, or the chunk directory for action=split." }),
  ),
  targetSize: Type.Optional(
    Type.Number({ description: "optimize: target file size in MB. Use this to hit a size budget." }),
  ),
  quality: Type.Optional(
    Type.Number({
      description: "optimize and batch: video CRF 0-51 where lower is better, or image quality 1-100. Default 85.",
    }),
  ),
  maxWidth: Type.Optional(Type.Number({ description: "optimize and batch: maximum width in pixels. Default 1920." })),
  bitrate: Type.Optional(Type.String({ description: "optimize and batch: audio bitrate, for example 64k." })),
  resolution: Type.Optional(
    Type.String({ description: "optimize: force video resolution, for example 1920x1080." }),
  ),
  chunkDuration: Type.Optional(
    Type.Number({ description: "split: chunk length in seconds. Default 3600, which is one hour." }),
  ),
  ...CommonFields,
});

type MediaParams = Static<typeof parameters>;

const VARIANTS: Record<Action, CommandVariant> = {
  optimize: {
    command: ["media", "optimize"],
    flags: {
      input: "--input",
      output: "--output",
      targetSize: "--target-size",
      quality: "--quality",
      maxWidth: "--max-width",
      bitrate: "--bitrate",
      resolution: "--resolution",
    },
    requireAll: ["input", "output"],
    note: "optimize rewrites one file, so both input and output are required.",
  },
  split: {
    command: ["media", "split"],
    flags: {
      input: "--input",
      outputDir: "--output-dir",
      chunkDuration: "--chunk-duration",
    },
    requireAll: ["input"],
  },
  batch: {
    command: ["media", "batch"],
    flags: {
      inputDir: "--input-dir",
      outputDir: "--output-dir",
      quality: "--quality",
      maxWidth: "--max-width",
      bitrate: "--bitrate",
    },
    requireAll: ["inputDir", "outputDir"],
  },
};

export function buildMediaArgs(params: MediaParams): string[] {
  return buildVariantArgs({
    toolName: "multix_media",
    variantLabel: `media ${params.action}`,
    variant: VARIANTS[params.action],
    params,
    extraKeys: ["action"],
  });
}

export const mediaTool = defineMultixTool({
  name: "multix_media",
  label: "Multix Media",
  description:
    "Compress, resize, convert, or split existing media files locally with ffmpeg and ImageMagick, using the multix CLI. No provider API key is needed, but ffmpeg or ImageMagick must be installed. Fast enough to run without raising the timeout.",
  promptSnippet: "Compress, resize, convert, or split local media files with ffmpeg/ImageMagick",
  promptGuidelines: [
    "Use multix_media when the user asks to compress, shrink, resize, convert, or split a local image, audio, or video file.",
    "Use multix_media with action optimize and targetSize to hit a specific file size limit, for example when a service rejects files over a fixed size.",
    "Call multix_check before multix_media when ffmpeg or ImageMagick availability is unknown, because these actions fail without them.",
  ],
  parameters,
  timeoutMs: 600_000,
  build: buildMediaArgs,
});
