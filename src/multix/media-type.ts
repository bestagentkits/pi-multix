/**
 * Detect a file's real type from its leading bytes.
 *
 * A provider returns whatever format it likes, and the CLI copies those bytes to
 * the `--output` path verbatim without transcoding. Asking for `out.png` while
 * the provider returns JPEG therefore produces a PNG-named file containing JPEG
 * data, which misleads every downstream tool that trusts the extension.
 *
 * Detection reads the magic bytes rather than believing the name, and the caller
 * renames the file so the name matches the content. Nothing is transcoded: the
 * bytes are never touched, only the name.
 */

import { closeSync, existsSync, openSync, readSync, renameSync } from "node:fs";
import { extname } from "node:path";

export type MediaType = "jpeg" | "png" | "webp" | "gif";

/** Every extension that legitimately denotes each type. */
const EXTENSIONS: Record<MediaType, readonly string[]> = {
  jpeg: [".jpg", ".jpeg"],
  png: [".png"],
  webp: [".webp"],
  gif: [".gif"],
};

/** The canonical extension written when a rename is needed. */
const CANONICAL: Record<MediaType, string> = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  gif: ".gif",
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function looksLikeJpeg(head: Buffer): boolean {
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

function looksLikePng(head: Buffer): boolean {
  return head.length >= 8 && head.subarray(0, 8).equals(PNG_MAGIC);
}

function looksLikeWebp(head: Buffer): boolean {
  return (
    head.length >= 12 &&
    head.subarray(0, 4).toString("ascii") === "RIFF" &&
    head.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function looksLikeGif(head: Buffer): boolean {
  return head.length >= 4 && head.subarray(0, 4).toString("ascii") === "GIF8";
}

const DETECTORS: ReadonlyArray<{ type: MediaType; matches: (head: Buffer) => boolean }> = [
  { type: "jpeg", matches: looksLikeJpeg },
  { type: "png", matches: looksLikePng },
  { type: "webp", matches: looksLikeWebp },
  { type: "gif", matches: looksLikeGif },
];

const HEAD_BYTES = 16;

/** Read the first bytes of a file. Returns null when it cannot be read. */
function readHead(path: string): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const head = Buffer.alloc(HEAD_BYTES);
    const bytesRead = readSync(descriptor, head, 0, HEAD_BYTES, 0);
    if (bytesRead < 4) return null;
    return head;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Nothing useful to do; the read result is what matters.
      }
    }
  }
}

/** The file's real image type, or null when it is not a recognised image. */
export function detectMediaType(path: string): MediaType | null {
  const head = readHead(path);
  if (head === null) return null;
  for (const detector of DETECTORS) {
    if (detector.matches(head)) return detector.type;
  }
  return null;
}

export function isKnownImageExtension(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return Object.values(EXTENSIONS).some((list) => list.includes(extension));
}

export interface NormalizationResult {
  requestedPath: string;
  /** The name the file should have for its content. */
  intendedPath: string;
  /** Where the file lives now: the same path unless a rename happened. */
  path: string;
  detected: MediaType;
  renamed: boolean;
  /** True when the file was left alone because the correct name was taken. */
  blockedByExistingFile: boolean;
}

/**
 * Rename a file whose extension disagrees with its content.
 *
 * Returns null when there is nothing to do: the file is missing, is not a
 * recognised image, has no image extension to correct, or is already named
 * correctly.
 *
 * Nothing is ever overwritten. If the correctly named path is already occupied
 * the file stays where it is and the caller reports the mismatch instead.
 */
export function normalizeImageExtension(requestedPath: string): NormalizationResult | null {
  if (!existsSync(requestedPath)) return null;
  if (!isKnownImageExtension(requestedPath)) return null;

  const detected = detectMediaType(requestedPath);
  if (detected === null) return null;

  const currentExtension = extname(requestedPath).toLowerCase();
  if (EXTENSIONS[detected].includes(currentExtension)) return null;

  const corrected = `${requestedPath.slice(0, requestedPath.length - currentExtension.length)}${CANONICAL[detected]}`;
  if (existsSync(corrected)) {
    return {
      requestedPath,
      intendedPath: corrected,
      path: requestedPath,
      detected,
      renamed: false,
      blockedByExistingFile: true,
    };
  }

  renameSync(requestedPath, corrected);
  return {
    requestedPath,
    intendedPath: corrected,
    path: corrected,
    detected,
    renamed: true,
    blockedByExistingFile: false,
  };
}

/** Extension for a detected type, for callers that need to report it. */
export function canonicalExtension(type: MediaType): string {
  return CANONICAL[type];
}
