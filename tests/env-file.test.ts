import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertKnownVariable,
  assertWritableValue,
  importSecret,
  isSecretVariable,
  mentionedVariables,
  parseEnvFile,
  permissionWarning,
  PROVIDERS,
  PROVIDER_IDS,
  readEnvFile,
  removeEnvVar,
  removeSecret,
  scaffoldEnvFile,
  upsertEnvVar,
  writeEnvFile,
} from "../src/multix/env-file.js";

/** A throwaway path so tests never touch the real ~/.multix/.env. */
function tempEnvPath(): string {
  return join(mkdtempSync(join(tmpdir(), "pi-multix-env-")), "nested", ".env");
}

describe("parseEnvFile", () => {
  it("ignores comments, blanks, and malformed lines", () => {
    const parsed = parseEnvFile(
      ["# a comment", "", "GEMINI_API_KEY=abc", "not-an-assignment", "=novalue"].join("\n"),
    );
    expect([...parsed.keys()]).toEqual(["GEMINI_API_KEY"]);
    expect(parsed.get("GEMINI_API_KEY")).toBe("abc");
  });

  it("accepts an export prefix", () => {
    expect(parseEnvFile("export GEMINI_API_KEY=abc").get("GEMINI_API_KEY")).toBe("abc");
  });

  it("unquotes double and single quoted values", () => {
    expect(parseEnvFile('A="with space"').get("A")).toBe("with space");
    expect(parseEnvFile("B='with space'").get("B")).toBe("with space");
    expect(parseEnvFile('C="say \\"hi\\""').get("C")).toBe('say "hi"');
  });

  it("keeps equals signs inside the value", () => {
    expect(parseEnvFile("A=base64==x").get("A")).toBe("base64==x");
  });
});

describe("upsertEnvVar", () => {
  it("appends a missing variable and reports it as added", () => {
    const result = upsertEnvVar("EXISTING=1\n", "GEMINI_API_KEY", "abc");
    expect(result.outcome).toBe("added");
    expect(result.content).toContain("GEMINI_API_KEY=abc");
    expect(result.content).toContain("EXISTING=1");
  });

  it("replaces an existing variable and reports it as replaced", () => {
    const result = upsertEnvVar("GEMINI_API_KEY=old\nOTHER=2\n", "GEMINI_API_KEY", "new");
    expect(result.outcome).toBe("replaced");
    expect(result.content).toContain("GEMINI_API_KEY=new");
    expect(result.content).not.toContain("old");
    expect(result.content).toContain("OTHER=2");
  });

  it("drops duplicate assignments, because dotenv lets the last one win", () => {
    const result = upsertEnvVar("K=first\nK=second\n", "K", "third");
    expect(result.content.match(/^K=/gm)).toHaveLength(1);
    expect(result.content).toContain("K=third");
    expect(result.content).not.toContain("second");
    expect(parseEnvFile(result.content).get("K")).toBe("third");
  });

  it("does not touch a variable whose name merely starts the same", () => {
    const result = upsertEnvVar("GEMINI_API_KEY_OLD=keep\n", "GEMINI_API_KEY", "new");
    expect(result.content).toContain("GEMINI_API_KEY_OLD=keep");
  });

  it("preserves comments", () => {
    const result = upsertEnvVar("# keep me\nK=1\n", "K", "2");
    expect(result.content).toContain("# keep me");
  });
});

describe("removeEnvVar", () => {
  it("removes every assignment and counts them", () => {
    const result = removeEnvVar("K=1\nOTHER=2\nK=3\n", "K");
    expect(result.removed).toBe(2);
    expect(result.content).toContain("OTHER=2");
    expect(result.content).not.toContain("K=");
  });

  it("reports zero when the variable is absent", () => {
    expect(removeEnvVar("A=1\n", "K").removed).toBe(0);
  });
});

describe("assertWritableValue", () => {
  it("accepts ordinary key shapes", () => {
    expect(() => assertWritableValue("AIzaSyB-._123")).not.toThrow();
  });

  it("rejects empty and whitespace-only values", () => {
    expect(() => assertWritableValue("")).toThrow(/empty/i);
    expect(() => assertWritableValue("   ")).toThrow(/empty/i);
  });

  it("rejects a line break, which could inject another variable", () => {
    expect(() => assertWritableValue("abc\nEVIL=1")).toThrow(/line break/i);
    expect(() => assertWritableValue("abc\r\nEVIL=1")).toThrow(/line break/i);
  });

  it("rejects a NUL byte", () => {
    expect(() => assertWritableValue("abc\0def")).toThrow(/NUL/i);
  });
});

describe("assertKnownVariable", () => {
  it("accepts every documented variable", () => {
    for (const provider of PROVIDER_IDS) {
      for (const name of PROVIDERS[provider].variables) {
        expect(assertKnownVariable(name)).toBe(name);
      }
    }
  });

  it("rejects an unknown name and lists the known ones", () => {
    expect(() => assertKnownVariable("PATH")).toThrow(/Unknown variable/);
    expect(() => assertKnownVariable("PATH")).toThrow(/GEMINI_API_KEY/);
  });

  it("rejects a malformed name", () => {
    expect(() => assertKnownVariable("EVIL;rm -rf")).toThrow(/not a valid environment variable name/);
  });
});

describe("isSecretVariable", () => {
  it("treats account identifiers as non-secret and keys as secret", () => {
    expect(isSecretVariable("CLOUDFLARE_ACCOUNT_ID")).toBe(false);
    expect(isSecretVariable("GEMINI_API_KEY")).toBe(true);
  });
});

describe("writeEnvFile and readEnvFile", () => {
  it("creates the file owner-readable only, with no temp file left behind", () => {
    const path = tempEnvPath();
    writeEnvFile("GEMINI_API_KEY=abc\n", path);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const leftovers = readdirSync(join(path, "..")).filter((name) => name.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("reports configured names without returning values", () => {
    const path = tempEnvPath();
    writeEnvFile('GEMINI_API_KEY="secret-value"\nEMPTY=\n', path);
    const snapshot = readEnvFile(path);
    expect(snapshot.exists).toBe(true);
    expect(snapshot.configured).toEqual(["GEMINI_API_KEY"]);
    // The snapshot type has no field that could carry a value.
    expect(Object.keys(snapshot).sort()).toEqual(["configured", "exists", "path"]);
  });

  it("reports a missing file rather than throwing", () => {
    const snapshot = readEnvFile(tempEnvPath());
    expect(snapshot.exists).toBe(false);
    expect(snapshot.configured).toEqual([]);
  });
});

describe("mentionedVariables", () => {
  it("finds active assignments", () => {
    expect([...mentionedVariables("A=1\nB=2")].sort()).toEqual(["A", "B"]);
  });

  it("finds commented placeholders, which is what makes scaffolding idempotent", () => {
    expect([...mentionedVariables("# GEMINI_API_KEY=<secret>")]).toEqual(["GEMINI_API_KEY"]);
  });

  it("ignores prose comments that are not assignments", () => {
    const names = mentionedVariables(
      ["# This file is read by the multix CLI after process.env and <cwd>/.env.", "# chmod 600"].join(
        "\n",
      ),
    );
    expect([...names]).toEqual([]);
  });

  it("does not mistake a sentence containing = for a variable", () => {
    expect([...mentionedVariables("# set the key with GEMINI_API_KEY=value here")]).toEqual([]);
  });
});

describe("scaffoldEnvFile", () => {
  it("creates a file of commented placeholders that configure nothing", () => {
    const path = tempEnvPath();
    const result = scaffoldEnvFile(["GEMINI_API_KEY", "OPENAI_API_KEY"], path);
    expect(result.created).toBe(true);
    expect(result.placeholders).toEqual(["GEMINI_API_KEY", "OPENAI_API_KEY"]);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("# GEMINI_API_KEY=<secret>");
    expect(parseEnvFile(content).size).toBe(0);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("never overwrites a value that is already set", () => {
    const path = tempEnvPath();
    writeEnvFile("GEMINI_API_KEY=keep-me\n", path);
    scaffoldEnvFile(["GEMINI_API_KEY", "OPENAI_API_KEY"], path);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("GEMINI_API_KEY=keep-me");
    expect(content).not.toContain("# GEMINI_API_KEY=");
    expect(content).toContain("# OPENAI_API_KEY=<secret>");
  });

  it("is idempotent once placeholders exist", () => {
    const path = tempEnvPath();
    scaffoldEnvFile(["GEMINI_API_KEY"], path);
    const second = scaffoldEnvFile(["GEMINI_API_KEY"], path);
    expect(second.placeholders).toEqual([]);
    expect(second.created).toBe(false);
  });
});

describe("permissionWarning", () => {
  it("stays silent for an owner-only file", () => {
    const path = tempEnvPath();
    writeEnvFile("GEMINI_API_KEY=abc\n", path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(permissionWarning(path)).toBeNull();
  });

  it("warns for a group- or world-readable file and gives the fix", () => {
    const path = tempEnvPath();
    writeEnvFile("GEMINI_API_KEY=abc\n", path);
    chmodSync(path, 0o644);

    const warning = permissionWarning(path);
    expect(warning).not.toBeNull();
    expect(warning).toContain(path);
    expect(warning).toMatch(/mode 644/);
    expect(warning).toMatch(/chmod 600/);
    expect(warning).toMatch(/chmod 700/);
  });

  it("warns for a group-readable file too", () => {
    const path = tempEnvPath();
    writeEnvFile("GEMINI_API_KEY=abc\n", path);
    chmodSync(path, 0o640);
    expect(permissionWarning(path)).not.toBeNull();
  });

  it("stays silent when the file does not exist", () => {
    expect(permissionWarning(tempEnvPath())).toBeNull();
  });
});

describe("importSecret", () => {
  it("adds a new secret with owner-only permissions", () => {
    const path = tempEnvPath();
    const result = importSecret({ variable: "GEMINI_API_KEY", value: "abc123", path });
    expect(result.outcome).toBe("added");
    expect(readFileSync(path, "utf8")).toContain("GEMINI_API_KEY=abc123");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("refuses to clobber an existing value unless overwrite is set", () => {
    const path = tempEnvPath();
    importSecret({ variable: "GEMINI_API_KEY", value: "first", path });
    expect(() => importSecret({ variable: "GEMINI_API_KEY", value: "second", path })).toThrow(
      /already has a value.*overwrite=true/s,
    );
    // The original value survived the refused write.
    expect(readFileSync(path, "utf8")).toContain("GEMINI_API_KEY=first");
  });

  it("replaces an existing value when overwrite is set", () => {
    const path = tempEnvPath();
    importSecret({ variable: "GEMINI_API_KEY", value: "first", path });
    const result = importSecret({ variable: "GEMINI_API_KEY", value: "second", path, overwrite: true });
    expect(result.outcome).toBe("replaced");
    const content = readFileSync(path, "utf8");
    expect(content).toContain("GEMINI_API_KEY=second");
    expect(content).not.toContain("first");
  });

  it("rejects an unknown variable", () => {
    expect(() => importSecret({ variable: "EVIL", value: "x", path: tempEnvPath() })).toThrow(
      /Unknown variable/,
    );
  });

  it("rejects a value containing a line break", () => {
    expect(() =>
      importSecret({ variable: "GEMINI_API_KEY", value: "abc\nEVIL=1", path: tempEnvPath() }),
    ).toThrow(/line break/i);
  });

  it("keeps other variables intact", () => {
    const path = tempEnvPath();
    importSecret({ variable: "OPENAI_API_KEY", value: "oa", path });
    importSecret({ variable: "GEMINI_API_KEY", value: "gm", path });
    const content = readFileSync(path, "utf8");
    expect(content).toContain("OPENAI_API_KEY=oa");
    expect(content).toContain("GEMINI_API_KEY=gm");
  });
});

describe("removeSecret", () => {
  it("removes a variable and reports the count", () => {
    const path = tempEnvPath();
    importSecret({ variable: "GEMINI_API_KEY", value: "abc", path });
    expect(removeSecret({ variable: "GEMINI_API_KEY", path })).toEqual({
      path,
      variable: "GEMINI_API_KEY",
      removed: 1,
    });
    expect(readFileSync(path, "utf8")).not.toContain("abc");
  });

  it("reports zero for a missing file instead of throwing", () => {
    expect(removeSecret({ variable: "GEMINI_API_KEY", path: tempEnvPath() }).removed).toBe(0);
  });
});
