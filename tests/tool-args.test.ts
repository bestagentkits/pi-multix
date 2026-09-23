import { describe, expect, it } from "vitest";
import { appendCommon, ensureSupported } from "../src/tools/shared.js";
import { buildImageArgs } from "../src/tools/image.js";
import { buildVideoArgs } from "../src/tools/video.js";
import { buildAudioArgs } from "../src/tools/audio.js";
import { buildMediaArgs } from "../src/tools/media.js";
import { buildDocArgs } from "../src/tools/doc.js";

describe("multix_image argv", () => {
  it("builds a gemini text-to-image command", () => {
    expect(
      buildImageArgs({
        action: "generate",
        provider: "gemini",
        prompt: "a red fox",
        aspectRatio: "16:9",
        numImages: 2,
        output: "out.png",
      }),
    ).toEqual([
      "gemini",
      "generate",
      "--prompt",
      "a red fox",
      "--aspect-ratio",
      "16:9",
      "--num-images",
      "2",
      "--output",
      "out.png",
    ]);
  });

  it("passes the leonardo prompt positionally", () => {
    expect(
      buildImageArgs({ action: "generate", provider: "leonardo", prompt: "a red fox", width: 1024 }),
    ).toEqual(["leonardo", "generate", "a red fox", "--width", "1024"]);
  });

  it("forwards the image-format opt-out", () => {
    expect(
      buildImageArgs({
        action: "generate",
        provider: "cloudflare",
        prompt: "a red fox",
        imageFormat: "original",
      }),
    ).toEqual(["cloudflare", "generate", "--prompt", "a red fox", "--image-format", "original"]);
  });

  it("repeats --ref for a multi-reference edit", () => {
    expect(
      buildImageArgs({
        action: "i2i",
        provider: "gemini",
        prompt: "make it watercolor",
        refs: ["a.png", "b.png"],
      }),
    ).toEqual([
      "gemini",
      "image-to-image",
      "--prompt",
      "make it watercolor",
      "--ref",
      "a.png",
      "--ref",
      "b.png",
    ]);
  });

  it("maps the byteplus generate reference flag to --input-image", () => {
    expect(
      buildImageArgs({
        action: "generate",
        provider: "byteplus",
        prompt: "a fox",
        inputImage: ["ref.png"],
      }),
    ).toEqual(["byteplus", "generate", "--prompt", "a fox", "--input-image", "ref.png"]);
  });

  it("omits booleans that are false", () => {
    expect(
      buildImageArgs({
        action: "generate",
        provider: "byteplus",
        prompt: "a fox",
        noWatermark: false,
      }),
    ).toEqual(["byteplus", "generate", "--prompt", "a fox"]);
  });

  it("rejects image-to-image for cloudflare", () => {
    expect(() =>
      buildImageArgs({ action: "i2i", provider: "cloudflare", prompt: "x", refs: ["a.png"] }),
    ).toThrow(/cloudflare has no image-to-image command/);
  });

  it("requires references for an edit", () => {
    expect(() => buildImageArgs({ action: "i2i", provider: "gemini", prompt: "x" })).toThrow(
      /needs at least one image in refs/,
    );
  });

  it("rejects multiple references for providers limited to one", () => {
    expect(() =>
      buildImageArgs({ action: "i2i", provider: "minimax", prompt: "x", refs: ["a.png", "b.png"] }),
    ).toThrow(/minimax accepts exactly one entry in refs/);
  });

  it("rejects references during generation", () => {
    expect(() =>
      buildImageArgs({ action: "generate", provider: "gemini", prompt: "x", refs: ["a.png"] }),
    ).toThrow(/refs only applies to action=i2i/);
  });

  it("reports a parameter the provider has no flag for", () => {
    expect(() =>
      buildImageArgs({ action: "generate", provider: "openai", prompt: "x", aspectRatio: "16:9" }),
    ).toThrow(/aspectRatio cannot be used with openai generate/);
  });
});

describe("multix_video argv", () => {
  it("builds a gemini text-to-video command with variadic reference images last", () => {
    expect(
      buildVideoArgs({
        action: "generate",
        provider: "gemini",
        prompt: "ocean waves",
        referenceImages: ["a.png", "b.png"],
      }),
    ).toEqual(["gemini", "generate-video", "--prompt", "ocean waves", "--reference-images", "a.png", "b.png"]);
  });

  it("passes the leonardo prompt positionally and omits unsupported duration", () => {
    expect(
      buildVideoArgs({ action: "generate", provider: "leonardo", prompt: "waves", resolution: "RESOLUTION_720" }),
    ).toEqual(["leonardo", "video", "waves", "--resolution", "RESOLUTION_720"]);
  });

  it("uses --image-url for openrouter image-to-video", () => {
    expect(
      buildVideoArgs({
        action: "i2v",
        provider: "openrouter",
        prompt: "pan left",
        image: "https://example.com/a.png",
      }),
    ).toEqual([
      "openrouter",
      "image-to-video",
      "--prompt",
      "pan left",
      "--image-url",
      "https://example.com/a.png",
    ]);
  });

  it("passes the image positionally for gemini image-to-video", () => {
    expect(buildVideoArgs({ action: "i2v", provider: "gemini", prompt: "pan left", image: "./a.png" })).toEqual([
      "gemini",
      "image-to-video",
      "./a.png",
      "--prompt",
      "pan left",
    ]);
  });

  it("expands byteplus audio into an explicit switch", () => {
    expect(
      buildVideoArgs({ action: "i2v", provider: "byteplus", prompt: "pan", image: "./a.png", audio: false }),
    ).toEqual(["byteplus", "image-to-video", "./a.png", "--prompt", "pan", "--no-audio"]);
  });

  it("builds a status poll for a job id", () => {
    expect(
      buildVideoArgs({ action: "status", provider: "openrouter", jobId: "job-1", wait: true }),
    ).toEqual(["openrouter", "video-status", "job-1", "--wait"]);
  });

  it("requires a job id for status", () => {
    expect(() => buildVideoArgs({ action: "status", provider: "openrouter" })).toThrow(/jobId is required/);
  });

  it("rejects status for providers without a status command", () => {
    expect(() => buildVideoArgs({ action: "status", provider: "minimax", jobId: "x" })).toThrow(
      /minimax has no video status command/,
    );
  });

  it("rejects text-to-video for openrouter", () => {
    expect(() => buildVideoArgs({ action: "generate", provider: "openrouter", prompt: "x" })).toThrow(
      /openrouter has no text-to-video command/,
    );
  });

  it("rejects image-to-video for minimax and points at firstFrame", () => {
    expect(() =>
      buildVideoArgs({ action: "i2v", provider: "minimax", prompt: "x", image: "./a.png" }),
    ).toThrow(/for minimax pass firstFrame with action=generate/);
  });

  it("requires a prompt for generation", () => {
    expect(() => buildVideoArgs({ action: "generate", provider: "gemini" })).toThrow(/prompt is required/);
  });

  it("requires an image for image-to-video", () => {
    expect(() => buildVideoArgs({ action: "i2v", provider: "gemini", prompt: "x" })).toThrow(
      /image is required/,
    );
  });
});

describe("multix_audio argv", () => {
  it("builds openai text-to-speech", () => {
    expect(
      buildAudioArgs({ action: "tts", provider: "openai", text: "hello", voice: "alloy" }),
    ).toEqual(["openai", "generate-speech", "--text", "hello", "--voice", "alloy"]);
  });

  it("repeats --speaker for gemini multi-speaker mode", () => {
    expect(
      buildAudioArgs({
        action: "tts",
        provider: "gemini",
        text: "hello",
        speaker: ["A:Kore", "B:Puck"],
      }),
    ).toEqual([
      "gemini",
      "generate-speech",
      "--text",
      "hello",
      "--speaker",
      "A:Kore",
      "--speaker",
      "B:Puck",
    ]);
  });

  it("emits gemini transcription files last because the option is variadic", () => {
    expect(
      buildAudioArgs({
        action: "transcribe",
        provider: "gemini",
        files: ["a.mp3", "b.mp3"],
        prompt: "Timestamps please",
      }),
    ).toEqual(["gemini", "transcribe", "--prompt", "Timestamps please", "--files", "a.mp3", "b.mp3"]);
  });

  it("rejects gemini transcription without files", () => {
    expect(() => buildAudioArgs({ action: "transcribe", provider: "gemini" })).toThrow(
      /requires files.*reads files, not input/s,
    );
  });

  it("accepts either lyrics or prompt for minimax music", () => {
    expect(buildAudioArgs({ action: "music", provider: "minimax", lyrics: "la la" })).toEqual([
      "minimax",
      "generate-music",
      "--lyrics",
      "la la",
    ]);
    expect(() => buildAudioArgs({ action: "music", provider: "minimax" })).toThrow(
      /requires lyrics or prompt/,
    );
  });

  it("requires a name for voice cloning", () => {
    expect(() => buildAudioArgs({ action: "clone", provider: "elevenlabs" })).toThrow(/requires name/);
    expect(
      buildAudioArgs({ action: "clone", provider: "elevenlabs", name: "Narrator", files: ["s1.wav", "s2.wav"] }),
    ).toEqual(["elevenlabs", "clone", "--name", "Narrator", "--files", "s1.wav", "s2.wav"]);
  });

  it("reports an action a provider does not support", () => {
    expect(() => buildAudioArgs({ action: "clone", provider: "openai", name: "x" })).toThrow(
      /action=clone is not available for openai/,
    );
  });

  it("rejects a parameter the provider has no flag for", () => {
    expect(() =>
      buildAudioArgs({ action: "tts", provider: "cloudflare", text: "hi", voice: "alloy" }),
    ).toThrow(/voice cannot be used with cloudflare generate-speech/);
  });
});

describe("multix_media argv", () => {
  it("builds an optimize command", () => {
    expect(
      buildMediaArgs({ action: "optimize", input: "in.mp4", output: "out.mp4", targetSize: 50 }),
    ).toEqual(["media", "optimize", "--input", "in.mp4", "--output", "out.mp4", "--target-size", "50"]);
  });

  it("reports every missing required parameter", () => {
    expect(() => buildMediaArgs({ action: "optimize", input: "in.mp4" })).toThrow(/requires output/);
    expect(() => buildMediaArgs({ action: "optimize" })).toThrow(/requires input and output/);
  });

  it("builds a batch command requiring both directories", () => {
    expect(buildMediaArgs({ action: "batch", inputDir: "raw", outputDir: "out" })).toEqual([
      "media",
      "batch",
      "--input-dir",
      "raw",
      "--output-dir",
      "out",
    ]);
    expect(() => buildMediaArgs({ action: "batch", inputDir: "raw" })).toThrow(/requires outputDir/);
    expect(() => buildMediaArgs({ action: "batch" })).toThrow(/requires inputDir and outputDir/);
  });

  it("builds a split command with defaults left to the CLI", () => {
    expect(buildMediaArgs({ action: "split", input: "long.mp4", chunkDuration: 600 })).toEqual([
      "media",
      "split",
      "--input",
      "long.mp4",
      "--chunk-duration",
      "600",
    ]);
  });
});

describe("multix_doc argv", () => {
  it("emits variadic input last for convert", () => {
    expect(
      buildDocArgs({ action: "convert", input: ["a.pdf", "b.pdf"], output: "out.md", autoName: false }),
    ).toEqual(["doc", "convert", "--output", "out.md", "--input", "a.pdf", "b.pdf"]);
  });

  it("requires an input for convert", () => {
    expect(() => buildDocArgs({ action: "convert" })).toThrow(/requires input/);
  });

  it("builds a gemini analyze command", () => {
    expect(
      buildDocArgs({ action: "analyze", files: ["clip.mp4"], prompt: "Summarize this", format: "markdown" }),
    ).toEqual([
      "gemini",
      "analyze",
      "--prompt",
      "Summarize this",
      "--format",
      "markdown",
      "--files",
      "clip.mp4",
    ]);
  });

  it("requires both files and prompt for extract", () => {
    expect(() => buildDocArgs({ action: "extract", files: ["a.pdf"] })).toThrow(/requires prompt/);
    expect(() => buildDocArgs({ action: "extract" })).toThrow(/requires files and prompt/);
  });

  it("rejects analyze without files", () => {
    expect(() => buildDocArgs({ action: "analyze", prompt: "x" })).toThrow(/requires files/);
  });
});

describe("shared helpers", () => {
  it("appends verbose before raw extra args", () => {
    const argv: string[] = [];
    appendCommon(argv, { verbose: true, extraArgs: ["--steps", "6"] });
    expect(argv).toEqual(["--verbose", "--steps", "6"]);
  });

  it("passes each extra arg element through as exactly one token", () => {
    const argv: string[] = [];
    appendCommon(argv, { extraArgs: ["--negative", "a big red car"] });
    expect(argv).toEqual(["--negative", "a big red car"]);
  });

  it("uses a stable key order derived from the table, not the caller", () => {
    const forward = buildImageArgs({
      action: "generate",
      provider: "gemini",
      prompt: "p",
      aspectRatio: "1:1",
      output: "o.png",
    });
    const reordered = buildImageArgs({
      output: "o.png",
      aspectRatio: "1:1",
      prompt: "p",
      provider: "gemini",
      action: "generate",
    } as never);
    expect(reordered).toEqual(forward);
  });

  it("lists supported parameters when rejecting an unknown one", () => {
    expect(() => ensureSupported("t", "variant", { bogus: "x" }, ["prompt"])).toThrow(
      /bogus cannot be used with variant/,
    );
  });
});
