/**
 * `multix_check` — provider key and tooling diagnostics.
 *
 * Note that multix exits non-zero when no provider key is configured, which this
 * tool surfaces as a failed tool call carrying the full report. That is
 * intentional: the report is the useful output either way.
 */

import { Type } from "typebox";
import { CommonFields, defineMultixTool } from "./shared.js";

const parameters = Type.Object({ ...CommonFields });

export const checkTool = defineMultixTool({
  name: "multix_check",
  label: "Multix Check",
  description:
    "Report which multix provider API keys, ffmpeg, ImageMagick, and the optional Codex image driver are available. Run this before a media task when it is unclear which providers can be used, or when a provider call failed with an auth error. Exits non-zero when no usable provider key is configured.",
  promptSnippet: "Check which multix provider keys and local tools are configured",
  promptGuidelines: [
    "Call multix_check before a multix image, video, audio, or document task when you do not already know which provider API keys are configured.",
    "Call multix_check after a multix provider call fails with an authentication or missing key error, to confirm which providers are actually available.",
  ],
  parameters,
  timeoutMs: 120_000,
  build: () => ["check"],
});
