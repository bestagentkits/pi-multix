import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import piMultix from "../src/index.js";
import { audioTool } from "../src/tools/audio.js";
import { checkTool } from "../src/tools/check.js";
import { docTool } from "../src/tools/doc.js";
import { imageTool } from "../src/tools/image.js";
import { mediaTool } from "../src/tools/media.js";
import { runTool } from "../src/tools/run.js";
import { videoTool } from "../src/tools/video.js";

const TOOLS = [checkTool, imageTool, videoTool, audioTool, mediaTool, docTool, runTool] as const;

const EXPECTED_NAMES = [
  "multix_check",
  "multix_image",
  "multix_video",
  "multix_audio",
  "multix_media",
  "multix_doc",
  "multix_run",
];

describe("extension entry point", () => {
  it("registers all seven multix tools", () => {
    const registered: string[] = [];
    const fakePi = {
      registerTool: (tool: { name: string }) => {
        registered.push(tool.name);
      },
    };
    // SAFETY: the extension factory only calls pi.registerTool during
    // registration, so a stub with that single method is a sufficient stand-in
    // for ExtensionAPI here.
    piMultix(fakePi as unknown as ExtensionAPI);

    expect(registered).toEqual([...EXPECTED_NAMES]);
  });

  it("exposes prompt metadata on every tool", () => {
    for (const tool of TOOLS) {
      const definition = tool as unknown as ToolDefinition;
      expect(definition.name).toMatch(/^multix_/);
      expect(definition.label.trim()).not.toBe("");
      expect(definition.description.trim()).not.toBe("");
      expect(definition.promptSnippet?.trim()).not.toBe("");
      expect(definition.parameters).toBeTypeOf("object");
      expect(typeof definition.execute).toBe("function");
    }
  });

  it("names the tool inside each prompt guideline", () => {
    // pi appends these bullets to a flat Guidelines section with no tool-name
    // prefix, so a bullet that does not name its tool is ambiguous to the model.
    for (const tool of TOOLS) {
      const definition = tool as unknown as ToolDefinition;
      for (const guideline of definition.promptGuidelines ?? []) {
        expect(guideline).toContain(definition.name);
      }
    }
  });

  it("gives every tool a wall-clock budget", () => {
    for (const tool of TOOLS) {
      expect((tool as unknown as { timeoutMs?: number }).timeoutMs).toBeGreaterThan(0);
    }
  });
});
