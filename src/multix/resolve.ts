/**
 * Locate the multix CLI entry point.
 *
 * `require.resolve("@mrgoonie/multix")` cannot be used here: that package's
 * `exports` map declares only an `import` condition, so CommonJS resolution
 * fails with ERR_PACKAGE_PATH_NOT_EXPORTED. Pi loads extensions through jiti,
 * which may present the module as CommonJS, so resolution walks the filesystem
 * for the published bin path instead. That works for both dependency layouts
 * pi can produce (nested in the package, or hoisted to a parent node_modules).
 */

import { accessSync, constants, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Published bin path relative to any directory that can resolve the package. */
const DEPENDENCY_ENTRY = join("node_modules", "@mrgoonie", "multix", "dist", "cli.js");

const SCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs"];

export interface MultixCommand {
  /** Executable to spawn. */
  command: string;
  /** Arguments that must precede the user args (the resolved script path, if any). */
  prefixArgs: string[];
  /** How the CLI was found, for diagnostics. */
  source: "env" | "dependency" | "path";
}

function walkUpForEntry(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, DEPENDENCY_ENTRY);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(): string | null {
  const pathValue = process.env.PATH ?? "";
  const isWindows = process.platform === "win32";
  const separator = isWindows ? ";" : ":";
  const extensions = isWindows ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];

  for (const dir of pathValue.split(separator)) {
    if (dir === "") continue;
    for (const extension of extensions) {
      const candidate = join(dir, `multix${extension}`);
      if (isExecutableFile(candidate)) return candidate;
      const lowered = join(dir, `multix${extension.toLowerCase()}`);
      if (lowered !== candidate && isExecutableFile(lowered)) return lowered;
    }
  }
  return null;
}

/** Directory containing this module, used as the first place to start the walk. */
export function extensionDirectory(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/**
 * Resolve how to invoke multix.
 *
 * Order: `MULTIX_BIN` override, then the bundled `@mrgoonie/multix`
 * dependency discovered from the extension directory, then from the working
 * directory, then a `multix` executable on PATH.
 */
export function resolveMultixCommand(
  options: { cwd?: string; extensionDir?: string } = {},
): MultixCommand | null {
  const override = process.env.MULTIX_BIN?.trim();
  if (override !== undefined && override !== "") {
    if (existsSync(override)) {
      const isScript = SCRIPT_EXTENSIONS.some((extension) => override.endsWith(extension));
      return isScript
        ? { command: process.execPath, prefixArgs: [override], source: "env" }
        : { command: override, prefixArgs: [], source: "env" };
    }
    // Not a path: treat it as a command name on PATH.
    return { command: override, prefixArgs: [], source: "env" };
  }

  const starts = [options.extensionDir ?? extensionDirectory(), options.cwd, process.cwd()].filter(
    (value): value is string => typeof value === "string" && value !== "",
  );

  for (const start of starts) {
    const entry = walkUpForEntry(start);
    if (entry) return { command: process.execPath, prefixArgs: [entry], source: "dependency" };
  }

  const onPath = findOnPath();
  if (onPath) return { command: onPath, prefixArgs: [], source: "path" };

  return null;
}
