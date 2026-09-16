/**
 * `multix_video` — text-to-video, image-to-video, and job status.
 *
 * Video commands differ more between providers than images do: command names,
 * the positional prompt, the positional image, and which flags exist all vary.
 * The branch tables below follow the multix CLI one for one.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { flag, repeat } from "../multix/argv.js";
import { applyFlags, CommonFields, ensureSupported, defineMultixTool } from "./shared.js";

type Provider = "gemini" | "minimax" | "openrouter" | "leonardo" | "byteplus" | "cloudflare";

const parameters = Type.Object({
  action: StringEnum(["generate", "i2v", "status"] as const, {
    description:
      "generate is text-to-video. i2v is image-to-video and needs image. status polls an asynchronous job started earlier and needs jobId.",
  }),
  provider: StringEnum(
    ["gemini", "minimax", "openrouter", "leonardo", "byteplus", "cloudflare"] as const,
    {
      description:
        "Which provider to call. Not every provider supports every action: minimax and cloudflare have no i2v command, and openrouter has no text-to-video. Status is unavailable for gemini and minimax in this tool.",
    },
  ),
  prompt: Type.Optional(
    Type.String({
      description: "Video or motion prompt. Required for action=generate and action=i2v; ignored for status.",
    }),
  ),
  image: Type.Optional(
    Type.String({
      description:
        "First-frame image for action=i2v. gemini and byteplus accept a local path or URL, openrouter requires a public https URL, and leonardo requires an existing Leonardo image id.",
    }),
  ),
  jobId: Type.Optional(
    Type.String({ description: "Job, task, or generation id to poll for action=status." }),
  ),
  model: Type.Optional(Type.String({ description: "Provider video model id. Omit for the provider default." })),
  resolution: Type.Optional(
    Type.String({
      description: "720p or 1080p for gemini; cloudflare takes 720p; byteplus takes 480p, 720p, 1080p or 2k; leonardo takes RESOLUTION_480, RESOLUTION_720 or RESOLUTION_1080.",
    }),
  ),
  duration: Type.Optional(Type.Number({ description: "Duration in seconds. Allowed values are model dependent." })),
  aspectRatio: Type.Optional(Type.String({ description: "Aspect ratio such as 16:9 or 9:16." })),
  fps: Type.Optional(Type.Number({ description: "cloudflare frames per second." })),
  seed: Type.Optional(Type.Number({ description: "Fixed seed (leonardo, byteplus, openrouter)." })),
  negative: Type.Optional(Type.String({ description: "Negative prompt (leonardo, byteplus)." })),
  audio: Type.Optional(
    Type.Boolean({ description: "byteplus only: true adds an audio track, false forces --no-audio." }),
  ),
  cameraFixed: Type.Optional(Type.Boolean({ description: "byteplus: lock the camera so there is no motion." })),
  async: Type.Optional(
    Type.Boolean({ description: "byteplus: submit the task and exit, printing the task id for a later status call." }),
  ),
  firstFrame: Type.Optional(
    Type.String({ description: "minimax generate: first-frame image URL." }),
  ),
  lastFrame: Type.Optional(
    Type.String({ description: "gemini and byteplus i2v: optional closing-frame image path or URL." }),
  ),
  lastFrameUrl: Type.Optional(
    Type.String({ description: "openrouter i2v: optional closing-frame image URL." }),
  ),
  referenceImages: Type.Optional(
    Type.Array(Type.String(), {
      description: "gemini generate: reference images, where the first is the opening frame and the second the closing frame.",
    }),
  ),
  uploadTimeout: Type.Optional(Type.Number({ description: "gemini: upload timeout in milliseconds." })),
  enhance: Type.Optional(Type.Boolean({ description: "leonardo i2v: enable prompt enhancement." })),
  frameInterpolation: Type.Optional(Type.Boolean({ description: "leonardo: enable frame interpolation." })),
  wait: Type.Optional(Type.Boolean({ description: "Poll until the job reaches a terminal state instead of returning immediately." })),
  waitTimeout: Type.Optional(Type.Number({ description: "Polling timeout in milliseconds." })),
  download: Type.Optional(Type.Boolean({ description: "Download the finished video (implies wait)." })),
  noThumb: Type.Optional(Type.Boolean({ description: "Skip downloading the provider thumbnail." })),
  output: Type.Optional(Type.String({ description: "Output video path or directory, relative to cwd unless absolute." })),
  ...CommonFields,
});

type VideoParams = Static<typeof parameters>;

const GENERATE_COMMAND: Partial<Record<Provider, string>> = {
  gemini: "generate-video",
  minimax: "generate-video",
  cloudflare: "generate-video",
  leonardo: "video",
  byteplus: "video",
};

const I2V_COMMAND: Partial<Record<Provider, string>> = {
  gemini: "image-to-video",
  leonardo: "image-to-video",
  byteplus: "image-to-video",
  openrouter: "image-to-video",
};

const STATUS_COMMAND: Partial<Record<Provider, string>> = {
  openrouter: "video-status",
  cloudflare: "video-status",
  byteplus: "status",
  leonardo: "status",
};

const GENERATE_FLAGS: Partial<Record<Provider, Record<string, string>>> = {
  gemini: {
    prompt: "--prompt",
    model: "--model",
    resolution: "--resolution",
    aspectRatio: "--aspect-ratio",
    referenceImages: "--reference-images",
    uploadTimeout: "--upload-timeout",
    output: "--output",
    noThumb: "--no-thumb",
  },
  minimax: {
    prompt: "--prompt",
    model: "--model",
    duration: "--duration",
    resolution: "--resolution",
    firstFrame: "--first-frame",
    output: "--output",
    noThumb: "--no-thumb",
  },
  // `leonardo video <prompt>` takes the prompt positionally and fixes duration at 8s.
  leonardo: {
    model: "--model",
    resolution: "--resolution",
    enhance: "--enhance",
    frameInterpolation: "--frame-interpolation",
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
    noThumb: "--no-thumb",
  },
  byteplus: {
    prompt: "--prompt",
    model: "--model",
    resolution: "--resolution",
    duration: "--duration",
    aspectRatio: "--aspect-ratio",
    seed: "--seed",
    negative: "--negative",
    cameraFixed: "--camera-fixed",
    async: "--async",
    waitTimeout: "--wait-timeout",
    output: "--output",
    noThumb: "--no-thumb",
  },
  cloudflare: {
    prompt: "--prompt",
    duration: "--duration",
    aspectRatio: "--aspect-ratio",
    resolution: "--resolution",
    fps: "--fps",
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
  },
};

const I2V_FLAGS: Partial<Record<Provider, Record<string, string>>> = {
  gemini: {
    prompt: "--prompt",
    lastFrame: "--last-frame",
    model: "--model",
    resolution: "--resolution",
    aspectRatio: "--aspect-ratio",
    output: "--output",
    noThumb: "--no-thumb",
  },
  leonardo: {
    prompt: "--prompt",
    imageType: "--image-type",
    model: "--model",
    resolution: "--resolution",
    duration: "--duration",
    seed: "--seed",
    negative: "--negative",
    enhance: "--enhance",
    frameInterpolation: "--frame-interpolation",
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
    noThumb: "--no-thumb",
  },
  byteplus: {
    prompt: "--prompt",
    model: "--model",
    resolution: "--resolution",
    duration: "--duration",
    aspectRatio: "--aspect-ratio",
    lastFrame: "--last-frame",
    seed: "--seed",
    negative: "--negative",
    cameraFixed: "--camera-fixed",
    async: "--async",
    waitTimeout: "--wait-timeout",
    output: "--output",
    noThumb: "--no-thumb",
  },
  openrouter: {
    prompt: "--prompt",
    image: "--image-url",
    lastFrameUrl: "--last-frame-url",
    model: "--model",
    resolution: "--resolution",
    aspectRatio: "--aspect-ratio",
    duration: "--duration",
    seed: "--seed",
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
    noThumb: "--no-thumb",
  },
};

const STATUS_FLAGS: Partial<Record<Provider, Record<string, string>>> = {
  openrouter: {
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
    noThumb: "--no-thumb",
  },
  cloudflare: {
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
  },
  byteplus: {
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
    noThumb: "--no-thumb",
  },
  leonardo: {
    wait: "--wait",
    waitTimeout: "--wait-timeout",
    download: "--download",
    output: "--output",
    noThumb: "--no-thumb",
  },
};

/** byteplus exposes audio as a pair of switches rather than one boolean. */
function pushAudioSwitch(argv: string[], audio: boolean | undefined): void {
  if (audio === true) argv.push("--audio");
  if (audio === false) argv.push("--no-audio");
}

export function buildVideoArgs(params: VideoParams): string[] {
  const { provider, action } = params;

  if (action === "status") {
    const command = STATUS_COMMAND[provider];
    const table = STATUS_FLAGS[provider];
    if (command === undefined || table === undefined) {
      throw new Error(
        `multix_video: ${provider} has no video status command. Use provider openrouter, cloudflare, byteplus, or leonardo for action=status.`,
      );
    }
    if (params.jobId === undefined || params.jobId.trim() === "") {
      throw new Error("multix_video: jobId is required for action=status.");
    }
    const argv: string[] = [provider, command, params.jobId];
    ensureSupported("multix_video", `${provider} ${command}`, params, [
      ...Object.keys(table),
      "action",
      "provider",
      "jobId",
    ]);
    applyFlags(argv, table, params);
    return argv;
  }

  if (params.prompt === undefined || params.prompt.trim() === "") {
    throw new Error(`multix_video: prompt is required for action=${action}.`);
  }

  if (action === "generate") {
    const command = GENERATE_COMMAND[provider];
    const table = GENERATE_FLAGS[provider];
    if (command === undefined || table === undefined) {
      throw new Error(
        `multix_video: ${provider} has no text-to-video command. Use provider gemini, minimax, leonardo, byteplus, or cloudflare for action=generate; openrouter only supports action=i2v.`,
      );
    }
    const argv: string[] = [provider, command];
    // byteplus exposes audio as a --audio/--no-audio pair that is handled below
    // rather than through the flag table, so it is allowed but not tabulated.
    const allowed: string[] = ["action", "provider", "prompt"];
    if (provider === "byteplus") allowed.push("audio");

    if (provider === "leonardo") argv.push(params.prompt);

    ensureSupported("multix_video", `${provider} ${command}`, params, [...Object.keys(table), ...allowed]);
    applyFlags(argv, table, params, ["referenceImages"]);
    if (provider === "byteplus") pushAudioSwitch(argv, params.audio);
    return argv;
  }

  const command = I2V_COMMAND[provider];
  const table = I2V_FLAGS[provider];
  if (command === undefined || table === undefined) {
    throw new Error(
      `multix_video: ${provider} has no image-to-video command. Use provider gemini, leonardo, byteplus, or openrouter for action=i2v; for minimax pass firstFrame with action=generate.`,
    );
  }
  if (params.image === undefined || params.image.trim() === "") {
    throw new Error(
      `multix_video: image is required for ${provider} action=i2v. gemini and byteplus take a path or URL, openrouter needs a public https URL, and leonardo needs an existing image id.`,
    );
  }

  const argv: string[] = [provider, command];
  // gemini, leonardo, and byteplus take the image positionally; openrouter uses --image-url.
  if (provider !== "openrouter") argv.push(params.image);

  const allowed: string[] = ["action", "provider", "image"];
  if (provider === "byteplus") allowed.push("audio");

  ensureSupported("multix_video", `${provider} ${command}`, params, [...Object.keys(table), ...allowed]);

  applyFlags(argv, table, params);

  // byteplus has no --audio entry in the table: it is a --audio/--no-audio pair.
  if (provider === "byteplus") pushAudioSwitch(argv, params.audio);

  return argv;
}

export const videoTool = defineMultixTool({
  name: "multix_video",
  label: "Multix Video",
  description:
    "Generate video from a text prompt or from a first-frame image using the multix CLI, and poll asynchronous jobs. Long jobs can take minutes: raise timeoutMs and pass wait or download so the CLI blocks until the file exists. Results land under ./multix-output/ unless output is set. Requires the selected provider's API key.",
  promptSnippet: "Generate video (text-to-video or image-to-video) via a provider API",
  promptGuidelines: [
    "Use multix_video when the user asks to generate, render, or animate video, or to turn an image into a video.",
    "Use multix_video with action i2v and image for image-to-video; use action generate for text-to-video.",
    "Use multix_video with action status and jobId to poll a job that was started with async or returned a job id without waiting.",
    "Raise multix_video timeoutMs for video, because generation routinely exceeds the 10 minute default when polling.",
  ],
  parameters,
  timeoutMs: 900_000,
  build: buildVideoArgs,
});
