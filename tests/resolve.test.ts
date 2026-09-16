import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMultixCommand } from "../src/multix/resolve.js";

const DEPENDENCY_ENTRY = join("@mrgoonie", "multix", "dist", "cli.js");

/** Create a fake installed dependency so the walk-up has something to find. */
function createFakeDependency(root: string): string {
  const entry = join(root, "node_modules", DEPENDENCY_ENTRY);
  mkdirSync(join(entry, ".."), { recursive: true });
  writeFileSync(entry, "// stub\n", "utf8");
  return entry;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolveMultixCommand", () => {
  it("walks up from the extension directory to the bundled dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-multix-resolve-"));
    createFakeDependency(root);
    const nested = join(root, "deep", "nested", "extension");
    mkdirSync(nested, { recursive: true });

    const resolved = resolveMultixCommand({ extensionDir: nested });

    expect(resolved?.source).toBe("dependency");
    expect(resolved?.command).toBe(process.execPath);
    expect(resolved?.prefixArgs).toEqual([join(root, "node_modules", DEPENDENCY_ENTRY)]);
  });

  it("prefers MULTIX_BIN when it points at an existing script", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-multix-bin-"));
    const script = join(dir, "custom-multix.js");
    writeFileSync(script, "// stub\n", "utf8");
    vi.stubEnv("MULTIX_BIN", script);

    const resolved = resolveMultixCommand({ extensionDir: dir });

    expect(resolved).toEqual({
      command: process.execPath,
      prefixArgs: [script],
      source: "env",
    });
  });

  it("treats a MULTIX_BIN that is not a path as a command name", () => {
    vi.stubEnv("MULTIX_BIN", "multix-canary");

    const resolved = resolveMultixCommand({ extensionDir: tmpdir() });

    expect(resolved).toEqual({ command: "multix-canary", prefixArgs: [], source: "env" });
  });

  it("returns null when no dependency, no PATH entry, and no override exist", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/nonexistent-pi-multix-probe");
    vi.stubEnv("PATH", "");
    vi.stubEnv("MULTIX_BIN", "");

    expect(resolveMultixCommand({ extensionDir: "/nonexistent-pi-multix-probe" })).toBeNull();
  });
});
