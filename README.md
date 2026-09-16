# pi-multix

A [pi](https://pi.dev) extension that brings the [multix](https://github.com/mrgoonie/multix-cli)
AI multimodal CLI to the pi coding agent: image generation and editing, video
generation, speech, transcription, music, sound effects, document conversion, and
local media processing.

## Install

```bash
pi install npm:pi-multix
```

Pi installs `@mrgoonie/multix` as a dependency automatically, so the CLI is
bundled and no separate global install is needed.

<details>
<summary>Other install options</summary>

```bash
# Pin a version
pi install npm:pi-multix@0.1.0

# From git
pi install git:github.com/bestagentkits/pi-multix

# Project-local instead of global
pi install npm:pi-multix -l
```

</details>

## Requirements

- Node.js 20 or newer.
- At least one provider API key for provider-backed work. `multix_media` needs no
  key, but requires `ffmpeg` or ImageMagick on `PATH`.

Keys are read from `process.env`, then `<cwd>/.env`, then `~/.multix/.env`:

| Provider | Environment variables |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Gemini | `GEMINI_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Leonardo | `LEONARDO_API_KEY` |
| BytePlus | `BYTEPLUS_API_KEY` or `ARK_API_KEY` |
| ElevenLabs | `ELEVENLABS_API_KEY` |
| Cloudflare | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (video also needs `CLOUDFLARE_AI_GATEWAY_ID` and `REPLICATE_API_TOKEN`) |

## Tools

| Tool | Purpose |
|---|---|
| `multix_check` | Report which provider keys, `ffmpeg`, and ImageMagick are available |
| `multix_image` | Generate an image, or edit an existing one (image-to-image) |
| `multix_video` | Text-to-video, image-to-video, and async job status |
| `multix_audio` | TTS, transcription, music, sound effects, voice cloning |
| `multix_media` | Local `ffmpeg`/ImageMagick compress, resize, and split |
| `multix_doc` | Documents to Markdown, file analysis, structured extraction |
| `multix_run` | Any other multix command, with an explicit argv array |

The extension also ships a `multix` skill containing provider-selection decision
trees and reference behavior, so the agent picks a sensible provider instead of
guessing.

### Examples

Once installed, these are model-facing tool calls rather than shell commands:

```
multix_image  action=generate provider=gemini prompt="a red fox in snow" aspectRatio=16:9
multix_image  action=i2i      provider=gemini prompt="make it watercolor" refs=["./photo.jpg"]
multix_video  action=i2v      provider=byteplus image="./frame.png" prompt="camera pans left" download=true
multix_audio  action=tts      provider=openai text="Hello world" output="hello.mp3"
multix_audio  action=transcribe provider=elevenlabs input="./call.mp3" format=srt
multix_doc    action=convert  input=["report.pdf"] output="report.md"
multix_media  action=optimize input="big.mp4" output="small.mp4" targetSize=50
multix_run    args=["leonardo","upscale","<generatedImageId>"]
```

## Behavior worth knowing

- **Output location.** Generated files go to `./multix-output/` unless
  `MULTIX_OUTPUT_DIR` or the `output` parameter redirects them.
- **Strict parameters.** A parameter the chosen provider does not support is
  rejected with an error naming the supported set, instead of being dropped
  silently. Use `extraArgs` for anything not modelled.
- **`extraArgs` is argv, not a shell string.** One array element is one argv
  token, appended verbatim. No shell is involved, so never add quotes or
  operators. Example: `extraArgs: ["--steps", "6"]`.
- **Long jobs.** Video and 3D generation commonly exceeds a minute. Pass `wait`
  or `download` so the CLI blocks until the file exists, and raise `timeoutMs`
  when needed. The default is 10 minutes, 15 for video.
- **Failures are errors.** A non-zero exit makes the tool call fail with the CLI's
  stdout and stderr attached, so provider diagnostics reach the model instead of
  being hidden.
- **No shell injection.** Every invocation uses `execFile` with an argv array.
  Prompts, paths, and URLs are never interpreted by a shell.

## Configuration

| Variable | Effect |
|---|---|
| `MULTIX_BIN` | Absolute path to the multix CLI entry, or a command name to use instead of the bundled dependency. Useful for a custom or globally installed CLI, or for testing a newer release. |
| `MULTIX_OUTPUT_DIR` | Where multix writes generated files. |

The bundled CLI is resolved by walking up from the extension directory, so both
pi layouts work: a dependency installed inside the package, and one hoisted to a
parent `node_modules`.

## Development

```bash
npm install
npm run verify        # typecheck, unit tests, build, then loader verification
npm run test          # unit tests only
npm run typecheck     # tsc --noEmit
npm run build         # bundle to dist/
npm run verify:loading # load the built bundle through pi's real loader
```

`npm run verify:loading` is the integration check. It loads the built bundle
through pi's extension loader (jiti plus pi's bundled-module alias map), asserts
that all seven tools register with prompt metadata, runs the real CLI through a
registered tool, confirms a non-zero exit surfaces the CLI diagnostics, and
confirms the bundled skill is discoverable.

Keep the `typebox` devDependency in step with the version pi bundles; the
[architecture notes](docs/architecture.md) explain why.

## Releasing

Releases publish from CI with no stored npm credential. Pushing a `v*` tag runs
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which uses
npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/): GitHub
mints a short-lived OIDC token for the job and the npm CLI exchanges it for a
publish credential scoped to that run. There is no `NPM_TOKEN` secret anywhere in
this repository, and npm attaches a provenance attestation automatically.

```bash
# 1. bump the version in package.json
# 2. tag it, with the tag matching the version exactly
git tag -a v0.2.0 -m "pi-multix 0.2.0"
git push origin v0.2.0
```

The workflow refuses to publish when the tag and `package.json` version disagree,
and `npm publish` runs the `prepublishOnly` gate (`npm run verify`) first, so an
untested release cannot be uploaded.

### One-time setup on npmjs.com

Trusted publishing is configured on the package, not in this repository. npm
verifies these values only when a publish is attempted, so a typo surfaces as an
`ENEEDAUTH` failure at release time rather than when saving.

1. Open the package settings for [`pi-multix`](https://www.npmjs.com/package/pi-multix)
   → **Trusted Publisher**.
2. Choose **GitHub Actions** and fill in:
   - **Organization or user**: `bestagentkits`
   - **Repository**: `pi-multix`
   - **Workflow filename**: `publish.yml` (filename only, and it is case-sensitive)
3. Under **Allowed actions**, permit `npm publish`. Leaving it at staged-only
   blocks a direct publish.

Once a CI release has succeeded, consider tightening the package under
**Settings → Publishing access** to *Require two-factor authentication and
disallow tokens*. That does not affect trusted publishing, and it removes the
long-lived-token path entirely.

## Design notes

The extension shells out to the `multix` CLI rather than importing its internals.
multix's public library entry point exports only its `core` module, so providers
and command modules are not a public contract and importing them would mean
fragile deep imports into `dist/`. The CLI's argv surface, by contrast, is
documented and stable, and it already covers every provider.

See [docs/architecture.md](docs/architecture.md) for resolution, argv
construction, and the TypeBox type-identity constraint, and
[docs/provider-matrix.md](docs/provider-matrix.md) for which provider supports
which action.

## License

MIT
