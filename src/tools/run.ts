/**
 * `multix_run` — escape hatch for the parts of the multix CLI the other tools do
 * not model.
 *
 * The capability tools cover the common paths with typed, validated parameters.
 * This tool trades that validation for reach: it forwards argv verbatim, so
 * anything multix supports is still reachable, including commands this package
 * does not wrap (for example `leonardo upscale`, `elevenlabs dub`, or
 * `byteplus reference-to-video`) and flags added by a newer CLI release.
 */

import { Type, type Static } from "typebox";
import { CommonFields, defineMultixTool } from "./shared.js";

const parameters = Type.Object({
  args: Type.Array(Type.String(), {
    description:
      'The complete multix argv after the program name, one array element per token. Example: ["gemini","generate","--prompt","a red fox","--aspect-ratio","16:9"]. No shell is involved, so do not add quotes, pipes, redirects, or a leading "multix".',
  }),
  cwd: CommonFields.cwd,
  timeoutMs: CommonFields.timeoutMs,
});

type RunParams = Static<typeof parameters>;

export const runTool = defineMultixTool({
  name: "multix_run",
  label: "Multix Run",
  description:
    "Run any multix command with an explicit argv array. Use this for capabilities the dedicated multix tools do not expose, or for flags added after this package was published. Prefer multix_image, multix_video, multix_audio, multix_media, or multix_doc when they cover the task, because they validate parameters and produce clearer errors.",
  promptSnippet: "Run an arbitrary multix command with an explicit argv array",
  promptGuidelines: [
    "Use multix_run only when no dedicated multix tool covers the task; multix_image, multix_video, multix_audio, multix_media, and multix_doc validate their parameters and are preferred.",
    "Use multix_run with args as one array element per argv token, and never include the program name, shell quoting, or shell operators.",
  ],
  parameters,
  timeoutMs: 900_000,
  build: (params: RunParams) => [...params.args],
});
