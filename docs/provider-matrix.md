# Provider matrix

Which providers support which action. A combination that is missing here is
rejected with an error naming the supported alternatives, because the underlying
CLI has no command for it.

## Images — `multix_image`

| Provider | `action=generate` | `action=i2i` | Notes |
|---|---|---|---|
| gemini | yes | yes | Multi-reference editing; best default for free-form edits |
| openai | yes | yes | `driver: codex` is an experimental image-only alternative that needs `codex login` |
| openrouter | yes | yes | Routes to Gemini, gpt-image, Recraft, Flux, and Seedream families; `strength` applies to Recraft only |
| byteplus | yes | yes | Seedream; `inputImage` adds generation references |
| minimax | yes | yes | i2i preserves a subject in a new scene; not a free-form editor, and one reference only |
| leonardo | yes | yes | Prompt is positional; i2i takes an existing Leonardo image id, not a file |
| cloudflare | yes | **no** | Workers AI FLUX.1 Schnell only, with a fixed model list |

## Video — `multix_video`

| Provider | `action=generate` | `action=i2v` | `action=status` | Notes |
|---|---|---|---|---|
| gemini | yes | yes | no | Veo; needs Google billing enabled |
| minimax | yes | **no** | no | Use `action=generate` with `firstFrame` for image-to-video |
| leonardo | yes | yes | yes | Widest model choice; prompt is positional and duration is fixed by the CLI |
| byteplus | yes | yes | yes | Seedance; `async` submits and returns a task id for a later status call |
| openrouter | **no** | yes | yes | Image input must be a public `https` URL |
| cloudflare | yes | **no** | yes | Replicate route via AI Gateway; also needs `REPLICATE_API_TOKEN` |

`action=status` takes a `jobId` and polls an asynchronous job.

## Audio — `multix_audio`

| Provider | `tts` | `transcribe` | `music` | `sfx` | `clone` |
|---|---|---|---|---|---|
| openai | yes | yes | no | no | no |
| gemini | yes | yes | no | no | no |
| minimax | yes | no | yes | no | no |
| elevenlabs | yes | yes | yes | yes | yes |
| cloudflare | yes | no | no | no | no |

- `transcribe` takes `input` for openai and elevenlabs, but `files` for gemini.
  Ask for `format srt` or `format vtt` for subtitles.
- gemini `tts` defaults to `gemini-3.8-flash-lite-tts`; pass `model
  gemini-3.8-flash-tts` for higher fidelity. Both read `text` verbatim, so use
  `style` for a performance direction (for example "cheerful and friendly")
  instead of stage directions in the text. `voice` accepts the prebuilt names
  or custom `voice_...`/`voicekey_...` ids.
- gemini transcription and analysis go through the Gemini Files API, so they are
  the choice for understanding video content.
- `clone` needs one to three minutes of clean sample audio.

## Documents — `multix_doc`

| Action | Command | Requires |
|---|---|---|
| `convert` | `doc convert` | `input`, and `GEMINI_API_KEY` |
| `analyze` | `gemini analyze` | `files`, and `GEMINI_API_KEY` |
| `extract` | `gemini extract` | `files` and `prompt`, and `GEMINI_API_KEY` |

## Local media — `multix_media`

| Action | Required | Needs |
|---|---|---|
| `optimize` | `input`, `output` | `ffmpeg` for video/audio, ImageMagick for images |
| `split` | `input` | `ffmpeg` |
| `batch` | `inputDir`, `outputDir` | `ffmpeg` and/or ImageMagick |

No provider key is required. `multix_check` reports whether the local tools are
installed.

## Anything else — `multix_run`

Commands this package does not wrap remain reachable, including:

- `leonardo upscale <generatedImageId>`, `leonardo variation <variationId>`,
  `leonardo models`, `leonardo me`
- `elevenlabs dub`, `elevenlabs dub-status <id>`, `elevenlabs voices`,
  `elevenlabs isolate`, `elevenlabs voice-changer`, `elevenlabs align`
- `byteplus reference-to-video`, `byteplus generate-3d`, `byteplus status <taskId>`
- `openrouter video-models`, `openrouter video-status <jobId>`
- `gemini extract`, `openai transcribe` with diarization options

Run `multix_run` with `args: ["--help"]` or `args: ["<provider>","--help"]` to
discover flags, which is also how to pick up flags added after this package was
published.
