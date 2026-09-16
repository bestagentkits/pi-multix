---
name: multix
description: AI multimodal generation and media processing through the multix tools (multix_image, multix_video, multix_audio, multix_media, multix_doc, multix_check, multix_run). Use when the user wants to generate or edit images (text-to-image, image-to-image, i2i, style transfer, watercolor, cyberpunk, reference image, Nano Banana, Flux, Seedream, Imagen, gpt-image), generate video (text-to-video, image-to-video, i2v, Veo, Hailuo, Kling, Seedance, LTX, Motion), produce speech or transcribe it (TTS, STT, subtitles, srt, vtt, voice cloning, music, sound effects), convert documents or PDFs to Markdown, analyze or extract data from files and video, or compress, resize, and split local media with ffmpeg and ImageMagick. Also use when a media task needs the right provider chosen, a provider API key is missing, or a generation call fails.
---

# multix — AI multimodal generation and media processing

`multix` is an AI multimodal CLI for image, video, audio, 3D, document, and media
work. This package wraps it as pi tools, so you call tools instead of composing
shell commands.

Provenance: this skill describes the CLI surface of `@mrgoonie/multix` 0.5.2.
When the CLI gains a command or flag that is missing here, reach it with
`multix_run` rather than guessing a flag name.

## Tools are the interface

Never shell out to `multix` with bash. Use the tools; they validate parameters,
report provider errors with the full CLI output, and stream progress.

| Tool | Use it for |
|---|---|
| `multix_check` | Which provider keys, ffmpeg, and ImageMagick are available |
| `multix_image` | Generate an image, or edit an existing one (i2i) |
| `multix_video` | Text-to-video, image-to-video, and job status |
| `multix_audio` | TTS, transcription, music, sound effects, voice cloning |
| `multix_media` | Local ffmpeg/ImageMagick compress, resize, split (no key needed) |
| `multix_doc` | Documents to Markdown, file analysis, structured extraction |
| `multix_run` | Anything the tools above do not cover |

## Start here when a provider is unknown

Call `multix_check` before a media task when you do not already know which keys
are configured. It lists which of `GEMINI_API_KEY`, `OPENAI_API_KEY`,
`MINIMAX_API_KEY`, `OPENROUTER_API_KEY`, `LEONARDO_API_KEY`, `BYTEPLUS_API_KEY`,
`ELEVENLABS_API_KEY`, and the Cloudflare pair are present, and whether `ffmpeg`
and `magick` are installed. It exits non-zero when no provider key is set, which
surfaces as a failed tool call carrying the report: read the report, do not
retry blindly.

Keys are read from the process environment, then `<cwd>/.env`, then
`~/.multix/.env`. Never print, echo, or embed a key value in a prompt, URL, or
output. If a key is missing, say so and name the provider that needs it.

## Provider selection

Choosing well matters more than passing many flags.

### Editing an existing image (i2i)

```text
Free-form prompt edit of a local file?
  ├── Best quality, fast, multi-reference      → provider gemini
  ├── A specific model family (gpt-image, Flux) → provider openrouter, model <id>
  ├── Need it recraft- or seedream-specific     → provider openrouter, model <id>
  └── Already hold a Leonardo image id          → provider leonardo
Preserve a character's identity in a new scene? → provider minimax (subject reference only)
ByteDance Seedream required?
  └── provider byteplus, or provider openrouter with model bytedance-seed/seedream-4.5
```

`minimax` i2i is not a free-form editor: it keeps a character consistent in a
new scene. `leonardo` i2i takes a Leonardo image id in `refs`, not a file path.
`cloudflare` has no i2i at all.

### Generating video

```text
Text-to-video?
  ├── Gemini Veo            → provider gemini   (needs Google billing)
  ├── MiniMax Hailuo        → provider minimax  (async, auto-polls)
  ├── Widest model choice   → provider leonardo (Motion, Veo, Kling, Hailuo, Seedance, LTX)
  ├── Seedance 2.0 direct   → provider byteplus
  └── Replicate via gateway → provider cloudflare (also needs REPLICATE_API_TOKEN)
Image-to-video?
  ├── Local file or URL     → provider gemini, leonardo, or byteplus
  ├── Public https URL only → provider openrouter
  └── MiniMax               → provider minimax, action generate with firstFrame
```

`openrouter` has no text-to-video. `cloudflare` has no image-to-video.

### Transcription and audio

Use `provider openai` or `provider elevenlabs` for `action transcribe`; they take
a single file in `input`. `provider gemini` takes `files` instead and is the
choice for understanding what is in a video. Ask for `format srt` or `format vtt`
when the user wants subtitles, because the default output is plain text.
For speech, music, and sound effects, prefer `elevenlabs` when its key exists and
`openai` or `minimax` otherwise.

## Output

Generated files are written under `./multix-output/` unless `MULTIX_OUTPUT_DIR`
or `output` redirects them. The tools print the CLI's stdout, which names the
files that were written. Report the actual saved path to the user rather than
guessing a filename, and read the file back when its contents matter.

## Reference behavior worth knowing

- **Refs**: local files are read and inlined as base64; URLs pass through. Allowed
  extensions are `.jpg .jpeg .png .webp .gif`. OpenRouter i2i caps a reference at
  8 MB; other providers allow 25 MB.
- **Aspect ratios**: `1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9` on most providers.
- **Long jobs**: video and 3D generation routinely exceeds the default timeout.
  Pass `wait` or `download` so the CLI blocks until the file exists, and raise
  `timeoutMs` (video defaults to 15 minutes).
- **Async video**: on `provider byteplus`, `async` submits and returns a task id.
  Poll it later with `multix_video` `action status` and `jobId`.
- **Per-provider parameters**: a parameter that the chosen provider does not
  document is rejected with an error naming the supported set. That is expected
  behavior, not a bug: switch provider or use `extraArgs`.
- **`extraArgs`**: one argv token per array element, appended verbatim. Use it for
  flags not exposed as parameters. No shell is involved, so quoting is never
  needed.
- **Codex image driver**: `multix_image` `driver: "codex"` uses the Codex CLI for
  OpenAI images and needs a prior `codex login`. It is experimental and
  image-only.

## Failure handling

Provider failures return the CLI exit code, stdout, and stderr. Read the stderr
block: it carries the provider's own error, the model id, and hints such as
modality mismatches. Do not retry the identical call; either fix the parameter
the error names, switch to a provider whose key is configured, or report the
failure. Never report success for a call that exited non-zero.

## Scope

These tools call provider APIs with the user's keys and write files locally.
They do not modify provider accounts, and they never transmit credentials. Refuse
requests to embed a key in a prompt or URL, and refuse requests to fetch
unrelated URLs.
