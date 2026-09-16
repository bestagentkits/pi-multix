/**
 * `multix_image` — text-to-image generation and image-to-image editing.
 *
 * The flag tables below mirror the multix CLI exactly. Providers differ in what
 * they accept, so a parameter that a provider does not document is rejected with
 * an actionable error instead of being silently dropped.
 */

import { isAbsolute, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { normalizeImageExtension } from "../multix/media-type.js";
import { applyFlags, CommonFields, ensureSupported, defineMultixTool } from "./shared.js";

const PROVIDERS = [
  "openai",
  "gemini",
  "minimax",
  "openrouter",
  "leonardo",
  "byteplus",
  "cloudflare",
] as const;

type Provider = (typeof PROVIDERS)[number];

const parameters = Type.Object({
  action: StringEnum(["generate", "i2i"] as const, {
    description:
      "generate creates an image from the prompt. i2i (image-to-image) edits or transforms the images in refs using the prompt.",
  }),
  provider: StringEnum(PROVIDERS, {
    description:
      "Which provider to call. Requires that provider's key: openai OPENAI_API_KEY, gemini GEMINI_API_KEY, minimax MINIMAX_API_KEY, openrouter OPENROUTER_API_KEY, leonardo LEONARDO_API_KEY, byteplus BYTEPLUS_API_KEY, cloudflare CLOUDFLARE_ACCOUNT_ID plus CLOUDFLARE_API_TOKEN. Run multix_check to see which are configured.",
  }),
  prompt: Type.String({
    description: "Image prompt. For i2i, describe the edit, for example \"make it watercolor\".",
  }),
  refs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Reference images for action=i2i. Accepts a local path or an https URL. Repeat for multiple references where the provider allows it. For leonardo these must be existing Leonardo image ids, not files.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Provider model id. Omit to use the provider default." })),
  aspectRatio: Type.Optional(
    Type.String({ description: "Aspect ratio such as 1:1, 16:9, 9:16, 4:3 (gemini, minimax, openrouter, byteplus)." }),
  ),
  size: Type.Optional(
    Type.String({
      description:
        "Output size. openai takes 1024x1024, 1024x1536, 1536x1024 or auto; gemini takes 1K, 2K or 4K; byteplus takes 1K, 2K, 4K or a WxH size.",
    }),
  ),
  imageSize: Type.Optional(Type.String({ description: "OpenRouter image size hint, for example 1K or 2K." })),
  numImages: Type.Optional(Type.Number({ description: "How many images to request when the provider supports batching." })),
  seed: Type.Optional(Type.Number({ description: "Fixed seed for reproducible output (leonardo, byteplus, cloudflare)." })),
  quality: Type.Optional(
    Type.String({ description: "openai: low, medium or high. leonardo GPT-image: LOW, MEDIUM or HIGH." }),
  ),
  format: Type.Optional(Type.String({ description: "openai output format: png, jpeg or webp." })),
  driver: Type.Optional(
    Type.String({ description: "openai driver: api, codex or auto. The codex driver needs a prior `codex login`." }),
  ),
  strength: Type.Optional(
    Type.Number({ description: "openrouter i2i init-image strength 0..1. Only used by Recraft models." }),
  ),
  width: Type.Optional(Type.Number({ description: "leonardo image width in pixels." })),
  height: Type.Optional(Type.Number({ description: "leonardo image height in pixels." })),
  negative: Type.Optional(Type.String({ description: "leonardo negative prompt." })),
  enhance: Type.Optional(Type.Boolean({ description: "leonardo: enable prompt enhancement." })),
  alchemy: Type.Optional(Type.Boolean({ description: "leonardo: enable Alchemy." })),
  ultra: Type.Optional(Type.Boolean({ description: "leonardo: enable Ultra mode." })),
  noDownload: Type.Optional(
    Type.Boolean({ description: "leonardo: skip downloading and print asset URLs only." }),
  ),
  noWatermark: Type.Optional(Type.Boolean({ description: "byteplus: disable the output watermark." })),
  inputImage: Type.Optional(
    Type.Array(Type.String(), {
      description: "byteplus generate: optional reference image path or URL; repeat for multi-reference.",
    }),
  ),
  imageType: Type.Optional(
    Type.String({ description: "leonardo i2i: whether the ref id is GENERATED or UPLOADED." }),
  ),
  initStrength: Type.Optional(
    Type.Number({ description: "leonardo i2i init-image strength 0.0-0.9, default 0.5." }),
  ),
  steps: Type.Optional(Type.Number({ description: "cloudflare inference steps, 1-8." })),
  output: Type.Optional(
    Type.String({ description: "Copy the primary output to this path, relative to cwd unless absolute." }),
  ),
  ...CommonFields,
});

type ImageParams = Static<typeof parameters>;

/** Flags for `<provider> generate`. */
const GENERATE_FLAGS: Record<Provider, Record<string, string>> = {
  openai: {
    prompt: "--prompt",
    model: "--model",
    driver: "--driver",
    size: "--size",
    quality: "--quality",
    format: "--format",
    numImages: "--num-images",
    output: "--output",
  },
  gemini: {
    prompt: "--prompt",
    model: "--model",
    aspectRatio: "--aspect-ratio",
    numImages: "--num-images",
    size: "--size",
    output: "--output",
  },
  minimax: {
    prompt: "--prompt",
    model: "--model",
    aspectRatio: "--aspect-ratio",
    numImages: "--num-images",
    output: "--output",
  },
  openrouter: {
    prompt: "--prompt",
    model: "--model",
    aspectRatio: "--aspect-ratio",
    imageSize: "--image-size",
    numImages: "--num-images",
    output: "--output",
  },
  // `leonardo generate <prompt>` takes the prompt positionally.
  leonardo: {
    model: "--model",
    width: "--width",
    height: "--height",
    numImages: "--num",
    seed: "--seed",
    negative: "--negative",
    quality: "--quality",
    enhance: "--enhance",
    alchemy: "--alchemy",
    ultra: "--ultra",
    noDownload: "--no-download",
    output: "--output",
  },
  byteplus: {
    prompt: "--prompt",
    model: "--model",
    size: "--size",
    aspectRatio: "--aspect-ratio",
    numImages: "--num-images",
    inputImage: "--input-image",
    seed: "--seed",
    noWatermark: "--no-watermark",
    output: "--output",
  },
  cloudflare: {
    prompt: "--prompt",
    model: "--model",
    steps: "--steps",
    seed: "--seed",
    output: "--output",
  },
};

/** Flags for `<provider> image-to-image`. cloudflare has no i2i command. */
const I2I_FLAGS: Partial<Record<Provider, Record<string, string>>> = {
  openai: {
    prompt: "--prompt",
    refs: "--ref",
    model: "--model",
    driver: "--driver",
    size: "--size",
    quality: "--quality",
    format: "--format",
    output: "--output",
  },
  gemini: {
    prompt: "--prompt",
    refs: "--ref",
    model: "--model",
    output: "--output",
  },
  minimax: {
    prompt: "--prompt",
    refs: "--ref",
    model: "--model",
    aspectRatio: "--aspect-ratio",
    numImages: "--num-images",
    output: "--output",
  },
  openrouter: {
    prompt: "--prompt",
    refs: "--ref",
    model: "--model",
    strength: "--strength",
    output: "--output",
  },
  // `leonardo i2i --ref` takes an existing Leonardo image id, not a file path.
  leonardo: {
    prompt: "--prompt",
    refs: "--ref",
    imageType: "--image-type",
    initStrength: "--init-strength",
    model: "--model",
    width: "--width",
    height: "--height",
    numImages: "--num",
    seed: "--seed",
    negative: "--negative",
    noDownload: "--no-download",
    output: "--output",
  },
  byteplus: {
    prompt: "--prompt",
    refs: "--ref",
    model: "--model",
    size: "--size",
    aspectRatio: "--aspect-ratio",
    numImages: "--num-images",
    seed: "--seed",
    noWatermark: "--no-watermark",
    output: "--output",
  },
};

/** Providers whose `--ref` accepts exactly one value. */
const SINGLE_REF_PROVIDERS: ReadonlySet<Provider> = new Set(["minimax", "leonardo"]);

/** Providers that take the generation prompt as a positional argument. */
const POSITIONAL_GENERATE_PROMPT: ReadonlySet<Provider> = new Set(["leonardo"]);

export function buildImageArgs(params: ImageParams): string[] {
  const { provider } = params;
  const editing = params.action === "i2i";
  const command = editing ? "image-to-image" : "generate";
  const variant = `${provider} ${command}`;
  const table = editing ? I2I_FLAGS[provider] : GENERATE_FLAGS[provider];

  if (table === undefined) {
    throw new Error(
      `multix_image: ${provider} has no image-to-image command. Use provider gemini, openai, minimax, openrouter, leonardo, or byteplus for action=i2i.`,
    );
  }

  const argv: string[] = [provider, command];
  const extraAllowed: string[] = ["action", "provider"];

  // The prompt is positional for some providers, a flag for the rest.
  if (!editing && POSITIONAL_GENERATE_PROMPT.has(provider)) {
    argv.push(params.prompt);
    extraAllowed.push("prompt");
  }

  if (editing) {
    const refs = params.refs ?? [];
    if (refs.length === 0) {
      throw new Error(
        `multix_image: ${variant} needs at least one image in refs. For leonardo, refs must be an existing Leonardo image id.`,
      );
    }
    if (SINGLE_REF_PROVIDERS.has(provider) && refs.length > 1) {
      throw new Error(
        `multix_image: ${provider} accepts exactly one entry in refs. Pass a single reference, or use gemini, openai, openrouter, or byteplus for multi-reference editing.`,
      );
    }
    if (provider === "leonardo") {
      extraAllowed.push("refs");
    }
  } else if ((params.refs ?? []).length > 0) {
    throw new Error(
      "multix_image: refs only applies to action=i2i. For byteplus reference images during generate, use inputImage.",
    );
  }

  ensureSupported("multix_image", variant, params, [
    ...Object.keys(table),
    ...extraAllowed,
  ]);

  applyFlags(argv, table, params);
  return argv;
}

export const imageTool = defineMultixTool({
  name: "multix_image",
  label: "Multix Image",
  description:
    "Generate an image from a text prompt, or edit an existing image with a prompt (image-to-image), using one of several AI providers through the multix CLI. Saves the result under ./multix-output/ unless output is set. Requires the selected provider's API key; call multix_check first if you are unsure which providers are configured.",
  promptSnippet: "Generate or edit images with a provider API",
  promptGuidelines: [
    "Use multix_image when the user asks to generate, draw, render, or create an image, or to edit or transform an existing image file.",
    "Use multix_image with action i2i and refs to edit an existing image; use action generate for text-to-image.",
    "Call multix_check before multix_image when it is unclear whether the required provider API key is configured.",
  ],
  parameters,
  timeoutMs: 600_000,
  build: buildImageArgs,
  // Providers choose the container, and the CLI copies those bytes to `output`
  // verbatim, so a request for out.png can yield JPEG data under a .png name.
  // Report the real path instead of leaving a misleading name behind.
  afterSuccess: (params, _result, { cwd }) => {
    const output = params.output?.trim() ?? "";
    if (output === "") return null;

    const requested = isAbsolute(output) ? output : resolve(cwd, output);
    const normalized = normalizeImageExtension(requested);
    if (normalized === null) return null;

    const format = normalized.detected.toUpperCase();
    if (normalized.blockedByExistingFile) {
      return [
        `Note: ${normalized.path} holds ${format} data but its name says otherwise.`,
        `It was left where it is, because ${normalized.intendedPath} already exists and was not overwritten.`,
      ].join("\n");
    }
    return [
      `Note: the provider returned ${format}, so the output file was renamed to match its real content.`,
      `  requested: ${normalized.requestedPath}`,
      `  actual:    ${normalized.path}`,
      "Use the actual path; the file was not transcoded, only renamed.",
    ].join("\n");
  },
});
