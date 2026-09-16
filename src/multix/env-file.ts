/**
 * Read and update `~/.multix/.env`.
 *
 * multix resolves configuration as `process.env` > `<cwd>/.env` > `~/.multix/.env`
 * (see its env-loader), so this file is the user-level place to keep provider
 * credentials.
 *
 * Two properties matter here, and both are security properties rather than
 * cosmetics:
 *
 * 1. **Values never leave this module.** Callers write a value and get back only
 *    whether the variable was added or replaced. Nothing returns the secret, so
 *    it cannot reach a tool result, a session log, or the model.
 * 2. **A value cannot inject another variable.** A newline inside a value would
 *    append an attacker-chosen line to the file, so values containing CR, LF, or
 *    NUL are rejected outright rather than escaped and hoped for.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Provider ids, declared as a literal tuple so they can be handed straight to
 * `StringEnum` and so `PROVIDERS` cannot silently miss one.
 */
export const PROVIDER_IDS = [
  "openai",
  "gemini",
  "minimax",
  "openrouter",
  "leonardo",
  "byteplus",
  "elevenlabs",
  "cloudflare",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Provider → the environment variables that configure it. */
export const PROVIDERS: Record<ProviderId, { label: string; variables: readonly string[] }> = {
  openai: { label: "OpenAI", variables: ["OPENAI_API_KEY"] },
  gemini: { label: "Gemini", variables: ["GEMINI_API_KEY"] },
  minimax: { label: "MiniMax", variables: ["MINIMAX_API_KEY"] },
  openrouter: { label: "OpenRouter", variables: ["OPENROUTER_API_KEY"] },
  leonardo: { label: "Leonardo", variables: ["LEONARDO_API_KEY"] },
  // Either variable authenticates BytePlus; ARK_API_KEY is the Volcengine name.
  byteplus: { label: "BytePlus", variables: ["BYTEPLUS_API_KEY", "ARK_API_KEY"] },
  elevenlabs: { label: "ElevenLabs", variables: ["ELEVENLABS_API_KEY"] },
  cloudflare: {
    label: "Cloudflare",
    variables: [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      // Only needed for Cloudflare-hosted video via the AI Gateway.
      "CLOUDFLARE_AI_GATEWAY_ID",
      "REPLICATE_API_TOKEN",
    ],
  },
};

/** Every variable name this tool is allowed to write. */
export const KNOWN_VARIABLES: readonly string[] = PROVIDER_IDS.flatMap(
  (provider) => PROVIDERS[provider].variables,
);

/** Environment variable names this tool will accept. */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a variable name against the known set.
 *
 * Rejecting unknown names keeps this tool from being used to write arbitrary
 * configuration, and rejecting malformed names keeps them out of the file.
 */
export function assertKnownVariable(name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`"${name}" is not a valid environment variable name.`);
  }
  if (!KNOWN_VARIABLES.includes(name)) {
    throw new Error(
      `Unknown variable "${name}". Known variables: ${KNOWN_VARIABLES.join(", ")}.`,
    );
  }
  return name;
}

/** Variables whose value is a secret, as opposed to an account identifier. */
const NON_SECRET_VARIABLES: readonly string[] = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_GATEWAY_ID",
  "BYTEPLUS_API_KEY",
  "ARK_API_KEY",
];

export function isSecretVariable(name: string): boolean {
  return !NON_SECRET_VARIABLES.includes(name);
}

/** Absolute path of the user-level env file. */
export function envFilePath(): string {
  return join(homedir(), ".multix", ".env");
}

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** Characters safe to write unquoted; anything else is wrapped in quotes. */
const SAFE_UNQUOTED = /^[A-Za-z0-9_\-.:/+=@]+$/;

/**
 * Reject values that cannot be represented safely on one line.
 *
 * A newline would let a value introduce an extra assignment, so this is a
 * rejection rather than an escaping problem.
 */
export function assertWritableValue(value: string): void {
  if (value.trim() === "") throw new Error("Refusing to write an empty value.");
  if (/[\r\n]/.test(value)) {
    throw new Error(
      "Refusing to write a value containing a line break, because that could inject another variable into the file.",
    );
  }
  if (value.includes("\0")) throw new Error("Refusing to write a value containing a NUL byte.");
}

function encodeValue(value: string): string {
  if (SAFE_UNQUOTED.test(value)) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Split a line into its assignment parts, or null when it is not an assignment.
 *
 * Deliberately string-based rather than a regular expression built from the
 * variable name, which would be a injection surface.
 */
function splitAssignment(line: string): { name: string; rawValue: string } | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const separator = withoutExport.indexOf("=");
  if (separator <= 0) return null;
  const name = withoutExport.slice(0, separator).trim();
  if (!NAME_PATTERN.test(name)) return null;
  return { name, rawValue: withoutExport.slice(separator + 1).trim() };
}

/** Remove dotenv's optional surrounding quotes from a raw value. */
function decodeValue(rawValue: string): string {
  if (rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (rawValue.length >= 2 && rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

/** Parse `NAME=value` lines. Comments and blanks are ignored; values are unquoted. */
export function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const assignment = splitAssignment(rawLine);
    if (assignment === null) continue;
    values.set(assignment.name, decodeValue(assignment.rawValue));
  }
  return values;
}

export interface UpsertResult {
  content: string;
  /** "added" when the variable was absent, "replaced" when an existing value changed. */
  outcome: "added" | "replaced";
}

/** Set `name` to `value`, leaving every other line untouched. */
export function upsertEnvVar(content: string, name: string, value: string): UpsertResult {
  assertWritableValue(value);
  const assignment = `${name}=${encodeValue(value)}`;
  const lines = content === "" ? [] : content.split(/\r?\n/);

  const matches: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = splitAssignment(lines[index] ?? "");
    if (parsed !== null && parsed.name === name) matches.push(index);
  }

  // Keep exactly one authoritative line. dotenv lets the last assignment win, so
  // leaving a stale duplicate behind would silently override the new value.
  const [firstMatch, ...duplicates] = matches;
  if (firstMatch !== undefined) {
    lines[firstMatch] = assignment;
    const duplicateIndexes = new Set(duplicates);
    const kept = lines.filter((_, index) => !duplicateIndexes.has(index));
    return { content: kept.join("\n"), outcome: "replaced" };
  }

  const trimmed = lines.join("\n").replace(/\n*$/, "");
  const prefix = trimmed === "" ? "" : `${trimmed}\n\n`;
  return { content: `${prefix}${assignment}\n`, outcome: "added" };
}

/** Remove every assignment of `name`. */
export function removeEnvVar(content: string, name: string): { content: string; removed: number } {
  const lines = content === "" ? [] : content.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const parsed = splitAssignment(line);
    return parsed === null || parsed.name !== name;
  });
  return { content: kept.join("\n"), removed: lines.length - kept.length };
}

export interface EnvFileSnapshot {
  path: string;
  exists: boolean;
  /** Variable names that currently hold a non-empty value. Values are never returned. */
  configured: string[];
}

export function readEnvFile(path = envFilePath()): EnvFileSnapshot {
  if (!existsSync(path)) return { path, exists: false, configured: [] };
  const parsed = parseEnvFile(readFileSync(path, "utf8"));
  const configured = [...parsed.entries()]
    .filter(([, value]) => value.trim() !== "")
    .map(([name]) => name);
  return { path, exists: true, configured };
}

/** Write the file with owner-only permissions, replacing it atomically. */
export function writeEnvFile(content: string, path = envFilePath()): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: DIR_MODE });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { mode: FILE_MODE });
    // writeFileSync mode is masked by umask, so set it explicitly.
    chmodSync(temporary, FILE_MODE);
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // Leaving a stray temp file is preferable to masking the real error.
      }
    }
    throw error;
  }
}

/**
 * Commented placeholders for variables that are not set yet.
 *
 * Commented lines cannot authenticate anything, so this is safe to run on an
 * existing file: it never changes a value that is already configured.
 */
export function placeholderBlock(variables: readonly string[]): string {
  const lines = [
    "# pi-multix: fill in keys below, then run multix_check to confirm.",
    "# This file is read by the multix CLI after process.env and <cwd>/.env.",
    "# Keep it owner-readable only (chmod 600).",
    "",
  ];
  for (const name of variables) {
    const hint = isSecretVariable(name) ? "<secret>" : "<value>";
    lines.push(`# ${name}=${hint}`);
  }
  return lines.join("\n");
}

export interface SecretMutation {
  path: string;
  variable: string;
  /** "added" when absent, "replaced" when an existing value was overwritten. */
  outcome: "added" | "replaced";
}

/**
 * Write a secret into the env file.
 *
 * `path` is injectable so the write path can be tested without touching the
 * user's real configuration file.
 */
export function importSecret(options: {
  variable: string;
  value: string;
  path?: string;
  overwrite?: boolean;
}): SecretMutation {
  const path = options.path ?? envFilePath();
  assertKnownVariable(options.variable);
  assertWritableValue(options.value);

  const snapshot = readEnvFile(path);
  if (snapshot.configured.includes(options.variable) && options.overwrite !== true) {
    throw new Error(
      `${options.variable} already has a value in ${path}. Pass overwrite=true to replace it. ` +
        "The existing value was not read.",
    );
  }

  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const { content, outcome } = upsertEnvVar(existing, options.variable, options.value);
  writeEnvFile(content, path);
  return { path, variable: options.variable, outcome };
}

/** Remove every assignment of a variable. Returns how many lines were dropped. */
export function removeSecret(options: { variable: string; path?: string }): {
  path: string;
  variable: string;
  removed: number;
} {
  const path = options.path ?? envFilePath();
  assertKnownVariable(options.variable);
  if (!existsSync(path)) return { path, variable: options.variable, removed: 0 };
  const { content, removed } = removeEnvVar(readFileSync(path, "utf8"), options.variable);
  if (removed > 0) writeEnvFile(content, path);
  return { path, variable: options.variable, removed };
}

/**
 * Names mentioned anywhere in the file, whether active or commented out.
 *
 * Scaffolding uses this rather than `parseEnvFile` so an existing commented
 * placeholder counts as covered; otherwise every run would append the block
 * again.
 */
export function mentionedVariables(content: string): Set<string> {
  const names = new Set<string>(parseEnvFile(content).keys());
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("#")) continue;
    const assignment = splitAssignment(line.replace(/^#+\s*/, ""));
    if (assignment !== null) names.add(assignment.name);
  }
  return names;
}

/** Scaffold missing placeholders, never touching a variable that is already set. */
export function scaffoldEnvFile(
  variables: readonly string[],
  path = envFilePath(),
): { path: string; created: boolean; placeholders: string[] } {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const mentioned = mentionedVariables(existing);
  const missing = variables.filter((name) => !mentioned.has(name));
  const heading = placeholderBlock(missing.length > 0 ? missing : variables);

  if (existing.trim() === "") {
    writeEnvFile(`${heading}\n`, path);
    return { path, created: true, placeholders: missing.length > 0 ? missing : [...variables] };
  }
  if (missing.length === 0) {
    return { path, created: false, placeholders: [] };
  }
  const body = existing.replace(/\n*$/, "");
  writeEnvFile(`${body}\n\n${heading}\n`, path);
  return { path, created: false, placeholders: missing };
}
