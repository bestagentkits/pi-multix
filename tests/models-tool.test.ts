import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { modelsTool } from "../src/tools/models.js";

/** Minimal stand-in: the tool only reads cwd from the context. */
// SAFETY: every action exercised here reads at most `cwd` from the context, so a
// partial object is a sufficient stand-in for the full ExtensionContext.
const ctx = { cwd: "/tmp" } as unknown as ExtensionContext;

async function runText(params: Parameters<typeof modelsTool.execute>[1]): Promise<string> {
  const result = await modelsTool.execute("test-call", params, undefined, undefined, ctx);
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

describe("multix_models parameters", () => {
  it("exposes no parameter that can carry a secret value", () => {
    const names = Object.keys(modelsTool.parameters.properties).map((name) => name.toLowerCase());
    // Tool arguments are persisted to the pi session log and sent to the model
    // provider, so the schema must never offer a place to put a key.
    for (const forbidden of ["apikey", "api_key", "key", "secret", "token", "password", "value"]) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toContain("fromenv");
    expect(names).toContain("fromfile");
    expect(names).toContain("variable");
  });

  it("does not offer an action for arbitrary file writes", () => {
    const names = Object.keys(modelsTool.parameters.properties).map((name) => name.toLowerCase());
    expect(names).not.toContain("path");
    expect(names).not.toContain("content");
  });
});

describe("multix_models providers", () => {
  it("lists variable names and status without printing any value", async () => {
    const canary = "CANARY-VALUE-SHOULD-NEVER-APPEAR-9f3a";
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = canary;
    try {
      const text = await runText({ action: "providers" });
      expect(text).not.toContain(canary);
      expect(text).toContain("GEMINI_API_KEY");
      expect(text).toMatch(/process\.env=set/);
      expect(text).toContain(".multix/.env");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  it("mentions the non-echoing ways to add a key", async () => {
    const text = await runText({ action: "providers" });
    expect(text).toMatch(/scaffold/);
    expect(text).toMatch(/fromEnv or fromFile/);
  });
});

describe("multix_models set-key", () => {
  it("refuses a call with no source and explains the safe options", async () => {
    await expect(runText({ action: "set-key", variable: "GEMINI_API_KEY" })).rejects.toThrow(
      /fromEnv.*fromFile/s,
    );
  });

  it("does not accept the key itself, and says why", async () => {
    await expect(runText({ action: "set-key", variable: "GEMINI_API_KEY" })).rejects.toThrow(
      /session log|model provider/,
    );
  });

  it("rejects an unknown variable before reading any source", async () => {
    await expect(
      runText({ action: "set-key", variable: "PATH", fromEnv: "PATH" }),
    ).rejects.toThrow(/Unknown variable/);
  });

  it("requires a variable name", async () => {
    await expect(runText({ action: "set-key", fromEnv: "GEMINI_API_KEY" })).rejects.toThrow(
      /variable is required/,
    );
  });

  it("rejects both sources at once", async () => {
    await expect(
      runText({
        action: "set-key",
        variable: "GEMINI_API_KEY",
        fromEnv: "GEMINI_API_KEY",
        fromFile: "/tmp/somewhere",
      }),
    ).rejects.toThrow(/not both/);
  });

  it("reports a missing source file by path without reading anything", async () => {
    await expect(
      runText({
        action: "set-key",
        variable: "GEMINI_API_KEY",
        fromFile: "/tmp/pi-multix-does-not-exist-9f3a",
      }),
    ).rejects.toThrow(/file not found/);
  });
});

describe("multix_models unset-key", () => {
  it("requires a variable name", async () => {
    await expect(runText({ action: "unset-key" })).rejects.toThrow(/variable is required/);
  });

  it("rejects an unknown variable", async () => {
    await expect(runText({ action: "unset-key", variable: "PATH" })).rejects.toThrow(/Unknown variable/);
  });
});

describe("multix_models models", () => {
  it("requires a provider", async () => {
    await expect(runText({ action: "models" })).rejects.toThrow(/provider is required/);
  });

  it("explains which providers can list models, for ones that cannot", async () => {
    await expect(runText({ action: "models", provider: "openai" })).rejects.toThrow(
      /no model listing command/,
    );
  });

  it("rejects a kind the provider does not offer", async () => {
    await expect(runText({ action: "models", provider: "openrouter", kind: "image" })).rejects.toThrow(
      /cannot list kind=image/,
    );
  });
});
