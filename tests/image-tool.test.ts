import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MultixRunResult } from "../src/multix/runner.js";
import { imageTool } from "../src/tools/image.js";

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

/** The hook ignores the run result, but a complete value keeps this honest. */
const RESULT: MultixRunResult = {
  argv: ["gemini", "generate"],
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 1,
  timedOut: false,
  aborted: false,
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-multix-image-"));
}

function runHook(params: Parameters<NonNullable<typeof imageTool.afterSuccess>>[0], cwd: string) {
  const hook = imageTool.afterSuccess;
  if (hook === undefined) throw new Error("imageTool has no afterSuccess hook");
  return hook(params, RESULT, { cwd });
}

describe("multix_image output normalization", () => {
  it("renames a JPEG that was written under a .png name and says so", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "out.png"), JPEG_HEADER);

    const note = runHook({ action: "generate", provider: "gemini", prompt: "x", output: "out.png" }, cwd);

    expect(note).toBeTruthy();
    expect(note).toMatch(/provider returned JPEG/);
    expect(note).toContain("out.png");
    expect(note).toContain("out.jpg");
    expect(note).toMatch(/not transcoded, only renamed/);
    // The bytes moved to the name that matches them.
    expect(existsSync(join(cwd, "out.jpg"))).toBe(true);
    expect(existsSync(join(cwd, "out.png"))).toBe(false);
  });

  it("leaves a correctly named file alone and stays quiet", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "out.jpg"), JPEG_HEADER);
    expect(
      runHook({ action: "generate", provider: "gemini", prompt: "x", output: "out.jpg" }, cwd),
    ).toBeNull();
    expect(existsSync(join(cwd, "out.jpg"))).toBe(true);
  });

  it("says nothing when no output path was requested", () => {
    const cwd = tempDir();
    expect(runHook({ action: "generate", provider: "gemini", prompt: "x" }, cwd)).toBeNull();
  });

  it("respects an absolute output path", () => {
    const cwd = tempDir();
    const target = join(tempDir(), "absolute.png");
    writeFileSync(target, PNG_HEADER);
    // PNG content under a .png name: already correct, so no note.
    expect(
      runHook({ action: "generate", provider: "gemini", prompt: "x", output: target }, cwd),
    ).toBeNull();
  });

  it("reports a rename that cannot happen, without losing either file", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "out.png"), JPEG_HEADER);
    writeFileSync(join(cwd, "out.jpg"), Buffer.from("do not clobber me"));

    const note = runHook({ action: "generate", provider: "gemini", prompt: "x", output: "out.png" }, cwd);

    expect(note).toMatch(/left where it is/);
    expect(note).toMatch(/already exists and was not overwritten/);
    expect(existsSync(join(cwd, "out.png"))).toBe(true);
    expect(existsSync(join(cwd, "out.jpg"))).toBe(true);
  });

  it("stays quiet for a format it does not recognise", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "out.png"), Buffer.from("definitely not an image"));
    expect(
      runHook({ action: "generate", provider: "gemini", prompt: "x", output: "out.png" }, cwd),
    ).toBeNull();
  });

  it("stays quiet when the output file is missing", () => {
    const cwd = tempDir();
    expect(
      runHook({ action: "generate", provider: "gemini", prompt: "x", output: "never-written.png" }, cwd),
    ).toBeNull();
  });
});
