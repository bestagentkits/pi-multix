import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalExtension,
  detectMediaType,
  isKnownImageExtension,
  normalizeImageExtension,
} from "../src/multix/media-type.js";

/** Minimal real headers, which is all detection reads. */
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0x56, 0x50, 0x38, 0x20]),
]);
const GIF_HEADER = Buffer.from("GIF89a....", "ascii");

function writeTemp(name: string, bytes: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), "pi-multix-media-")), name);
  writeFileSync(path, bytes);
  return path;
}

describe("detectMediaType", () => {
  it("identifies each supported format from its magic bytes", () => {
    expect(detectMediaType(writeTemp("a.jpg", JPEG_HEADER))).toBe("jpeg");
    expect(detectMediaType(writeTemp("b.png", PNG_HEADER))).toBe("png");
    expect(detectMediaType(writeTemp("c.webp", WEBP_HEADER))).toBe("webp");
    expect(detectMediaType(writeTemp("d.gif", GIF_HEADER))).toBe("gif");
  });

  it("trusts the content, not the name", () => {
    // JPEG bytes stored under a .png name, which is the bug this guards.
    expect(detectMediaType(writeTemp("misleading.png", JPEG_HEADER))).toBe("jpeg");
  });

  it("returns null for unrecognised or truncated content", () => {
    expect(detectMediaType(writeTemp("x.bin", Buffer.from("not an image at all")))).toBeNull();
    expect(detectMediaType(writeTemp("short.bin", Buffer.from([0x89, 0x50])))).toBeNull();
  });

  it("returns null for a missing file instead of throwing", () => {
    expect(detectMediaType("/tmp/pi-multix-missing-9f3a.png")).toBeNull();
  });
});

describe("isKnownImageExtension", () => {
  it("accepts image extensions case-insensitively", () => {
    expect(isKnownImageExtension("a.PNG")).toBe(true);
    expect(isKnownImageExtension("a.jpeg")).toBe(true);
    expect(isKnownImageExtension("a.webp")).toBe(true);
    expect(isKnownImageExtension("a.gif")).toBe(true);
  });

  it("rejects other extensions and no extension", () => {
    expect(isKnownImageExtension("a.mp4")).toBe(false);
    expect(isKnownImageExtension("a.txt")).toBe(false);
    expect(isKnownImageExtension("noextension")).toBe(false);
  });
});

describe("normalizeImageExtension", () => {
  it("renames a JPEG named .png and reports both paths", () => {
    const requested = writeTemp("output.png", JPEG_HEADER);
    const result = normalizeImageExtension(requested);

    expect(result).not.toBeNull();
    expect(result?.detected).toBe("jpeg");
    expect(result?.renamed).toBe(true);
    expect(result?.requestedPath).toBe(requested);
    expect(result?.intendedPath).toBe(requested.replace(/\.png$/, ".jpg"));
    expect(result?.path).toBe(result?.intendedPath);
    expect(existsSync(result?.path ?? "")).toBe(true);
    expect(existsSync(requested)).toBe(false);
  });

  it("renames a PNG named .jpg", () => {
    const requested = writeTemp("output.jpg", PNG_HEADER);
    const result = normalizeImageExtension(requested);
    expect(result?.detected).toBe("png");
    expect(result?.path).toBe(requested.replace(/\.jpg$/, ".png"));
  });

  it("leaves a correctly named file alone", () => {
    expect(normalizeImageExtension(writeTemp("ok.jpg", JPEG_HEADER))).toBeNull();
    expect(normalizeImageExtension(writeTemp("ok.jpeg", JPEG_HEADER))).toBeNull();
    expect(normalizeImageExtension(writeTemp("ok.png", PNG_HEADER))).toBeNull();
  });

  it("leaves a file with a non-image extension alone", () => {
    expect(normalizeImageExtension(writeTemp("data.bin", JPEG_HEADER))).toBeNull();
  });

  it("leaves a file with no extension alone", () => {
    expect(normalizeImageExtension(writeTemp("noext", JPEG_HEADER))).toBeNull();
  });

  it("does not overwrite an existing file of the correct name", () => {
    const requested = writeTemp("clash.png", JPEG_HEADER);
    const occupied = requested.replace(/\.png$/, ".jpg");
    writeFileSync(occupied, Buffer.from("pre-existing, must survive"));

    const result = normalizeImageExtension(requested);

    expect(result?.renamed).toBe(false);
    expect(result?.blockedByExistingFile).toBe(true);
    expect(result?.path).toBe(requested);
    expect(result?.intendedPath).toBe(occupied);
    // Both files survived untouched.
    expect(existsSync(requested)).toBe(true);
    expect(existsSync(occupied)).toBe(true);
  });

  it("returns null for a missing file", () => {
    expect(normalizeImageExtension("/tmp/pi-multix-missing-9f3a.png")).toBeNull();
  });
});

describe("canonicalExtension", () => {
  it("maps each type to one extension", () => {
    expect(canonicalExtension("jpeg")).toBe(".jpg");
    expect(canonicalExtension("png")).toBe(".png");
    expect(canonicalExtension("webp")).toBe(".webp");
    expect(canonicalExtension("gif")).toBe(".gif");
  });
});
