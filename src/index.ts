/**
 * pi-multix — pi extension entry point.
 *
 * Registers the multix tools. All behaviour lives in ./tools/*; this module only
 * wires them into pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { audioTool } from "./tools/audio.js";
import { checkTool } from "./tools/check.js";
import { docTool } from "./tools/doc.js";
import { imageTool } from "./tools/image.js";
import { mediaTool } from "./tools/media.js";
import { runTool } from "./tools/run.js";
import { videoTool } from "./tools/video.js";

const TOOLS = [
  checkTool,
  imageTool,
  videoTool,
  audioTool,
  mediaTool,
  docTool,
  runTool,
] as const;

export default function piMultix(pi: ExtensionAPI): void {
  for (const tool of TOOLS) {
    pi.registerTool(tool);
  }
}
