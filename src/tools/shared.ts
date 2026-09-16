/**
 * Shared machinery for the multix tools.
 *
 * Each tool module declares a pure argv `build` function plus a flag table that
 * maps a parameter name to the CLI flag that provider actually accepts. The
 * tables mirror the multix CLI surface exactly, so a parameter is only ever
 * passed to a provider that documents it.
 *
 * ## TypeBox identity
 *
 * pi loads extensions through jiti with a module alias that maps `typebox`,
 * `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and
 * `@earendil-works/pi-coding-agent` to pi's own bundled copies. At runtime there
 * is therefore exactly one TypeBox instance.
 *
 * During local development npm also keeps a copy of `typebox` nested inside
 * `@earendil-works/pi-coding-agent`, so two physically distinct `TSchema` types
 * exist and TypeScript refuses to treat them as the same type. The schemas here
 * are still authored with TypeBox `Type` helpers — which is what matters, since
 * they are plain data validated by pi. Only the single hand-off into
 * `defineTool` crosses that boundary, and it is cast there, so no other part of
 * this package has to care which copy pi bundled.
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { flag, isProvided } from "../multix/argv.js";
import { clampTimeout, DEFAULT_TIMEOUT_MS, runMultix, type MultixRunResult } from "../multix/runner.js";

/** TypeBox schema type as resolved by the TypeBox copy pi bundles. */
type PiSchema = ToolDefinition["parameters"];

/** Parameter names every tool accepts on top of its own flags. */
export const COMMON_KEYS = ["cwd", "timeoutMs", "verbose", "extraArgs"] as const;

export const CommonFields = {
  cwd: Type.Optional(
    Type.String({
      description:
        "Directory to run multix in (defaults to the session working directory). Provider keys are read from process.env, then <cwd>/.env, then ~/.multix/.env, and relative input/output paths resolve against it.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description:
        "Wall-clock budget in milliseconds. Defaults to 600000 (10 minutes); clamped to 3600000. Raise it for long video or 3D jobs.",
    }),
  ),
  verbose: Type.Optional(
    Type.Boolean({ description: "Pass --verbose so multix logs provider requests and polling." }),
  ),
  extraArgs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Extra multix argv tokens appended verbatim, one token per array element. Example: ["--steps","6"]. No shell is involved, so quoting and escaping are unnecessary. Use this for CLI flags this tool does not expose.',
    }),
  ),
};

export interface CommonParams {
  cwd?: string;
  timeoutMs?: number;
  verbose?: boolean;
  extraArgs?: string[];
}

/**
 * Details attached to every multix tool result. Kept lean on purpose: the full
 * CLI output lives in the result content, while details are persisted in session
 * state for rendering.
 */
export interface MultixDetails {
  argv: string[];
  /** "running" while the CLI is still executing, "done" once it has exited. */
  phase: "running" | "done";
  exitCode?: number;
  durationMs?: number;
}

/** Fail with an actionable message when a parameter is not valid for this provider. */
export function ensureSupported(
  toolName: string,
  variant: string,
  params: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set<string>([...allowed, ...COMMON_KEYS]);
  const unsupported = Object.entries(params)
    .filter(([key, value]) => isProvided(value) && !allowedSet.has(key))
    .map(([key]) => key);
  if (unsupported.length === 0) return;
  throw new Error(
    `${toolName}: ${unsupported.join(", ")} cannot be used with ${variant}. ` +
      `Supported parameters here: ${[...allowedSet].sort().join(", ")}. ` +
      "Pass anything else through extraArgs.",
  );
}

export interface CommandVariant {
  /** Leading argv entries, for example ["gemini", "analyze"] or ["doc", "convert"]. */
  command: string[];
  /** Parameter name to CLI flag. */
  flags: Record<string, string>;
  /** Flags that take multiple values after them; emitted after the scalar flags. */
  variadic?: readonly string[];
  /** At least one of these parameter names must be supplied. */
  requireAny?: readonly string[];
  /** Every one of these parameter names must be supplied. */
  requireAll?: readonly string[];
  /** Extra guidance appended to a requirement error. */
  note?: string;
}

function missingRequirement(
  variant: CommandVariant,
  params: Record<string, unknown>,
): string | null {
  const missingAll = (variant.requireAll ?? []).filter((key) => !isProvided(params[key]));
  if (missingAll.length > 0) return `requires ${missingAll.join(" and ")}`;
  const anyOf = variant.requireAny ?? [];
  if (anyOf.length > 0 && !anyOf.some((key) => isProvided(params[key]))) {
    return `requires ${anyOf.join(" or ")}`;
  }
  return null;
}

/**
 * Validate parameters against one CLI subcommand and build its argv.
 *
 * `prefix` is prepended to the variant command (used when the provider name is
 * itself an argv token). `extraKeys` covers schema metadata the caller owns
 * (typically `action` and `provider`) so it is not reported as an unsupported
 * flag.
 */
export function buildVariantArgs(options: {
  toolName: string;
  variantLabel: string;
  variant: CommandVariant;
  params: Record<string, unknown>;
  prefix?: readonly string[];
  extraKeys?: readonly string[];
}): string[] {
  const { toolName, variantLabel, variant, params } = options;

  ensureSupported(toolName, variantLabel, params, [
    ...Object.keys(variant.flags),
    ...(options.extraKeys ?? []),
  ]);

  const failure = missingRequirement(variant, params);
  if (failure !== null) {
    throw new Error(
      `${toolName}: ${variantLabel} ${failure}.${variant.note !== undefined ? ` ${variant.note}` : ""}`,
    );
  }

  const argv = [...(options.prefix ?? []), ...variant.command];
  applyFlags(argv, variant.flags, params, variant.variadic ?? []);
  return argv;
}

/**
 * Apply a parameter→flag table, deferring variadic options until the end.
 *
 * Iteration follows the table rather than the parameter object, so argv order is
 * stable no matter which order the model emitted its arguments in. That keeps
 * logs, tests, and command replay deterministic.
 */
export function applyFlags(
  argv: string[],
  table: Record<string, string>,
  params: Record<string, unknown>,
  variadicKeys: readonly string[] = [],
): void {
  const deferred: Array<[string, string[]]> = [];
  for (const [key, flagName] of Object.entries(table)) {
    const raw = params[key];
    if (!isProvided(raw)) continue;
    if (Array.isArray(raw)) {
      const values = raw.filter((value): value is string => typeof value === "string");
      if (variadicKeys.includes(key)) deferred.push([flagName, values]);
      else for (const value of values) flag(argv, flagName, value);
    } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      flag(argv, flagName, raw);
    }
  }
  // A variadic option is greedy up to the next "-"-prefixed token, so it is
  // always emitted after the scalar flags.
  for (const [flagName, values] of deferred) {
    const filtered = values.filter((value) => value.trim() !== "");
    if (filtered.length > 0) argv.push(flagName, ...filtered);
  }
}

/** Append the flags every tool shares: --verbose then raw extraArgs. */
export function appendCommon(argv: string[], params: CommonParams): void {
  flag(argv, "--verbose", params.verbose);
  for (const token of params.extraArgs ?? []) {
    if (typeof token === "string" && token.trim() !== "") argv.push(token);
  }
}

const MAX_STREAM_PREVIEW = 600;
const MAX_RESULT_SECTION = 20_000;

function tail(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(trimmed.length - max)}`;
}

function section(text: string, max = MAX_RESULT_SECTION): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n…[truncated ${trimmed.length - max} characters; rerun with verbose output or read the output file directly]`;
}

/**
 * Render a finished run as the tool's text content. Everything the CLI emits is
 * preserved so provider diagnostics are never hidden; only very large dumps are
 * truncated, and the truncation is stated.
 */
export function formatRunResult(result: MultixRunResult, cwd: string): string {
  const lines: string[] = [
    `$ multix ${result.argv.join(" ")}`,
    `cwd: ${cwd}`,
    `exit: ${result.exitCode} (${result.durationMs}ms)`,
  ];
  if (result.timedOut) {
    lines.push("status: TIMED OUT — the CLI was killed; raise timeoutMs for long jobs");
  }
  if (result.aborted) lines.push("status: ABORTED by the user");

  if (result.stdout.trim() !== "") lines.push("", "--- stdout ---", section(result.stdout));
  if (result.stderr.trim() !== "") lines.push("", "--- stderr ---", section(result.stderr));
  if (result.stdout.trim() === "" && result.stderr.trim() === "") lines.push("", "(no output)");

  if (result.exitCode === 0) {
    lines.push(
      "",
      "Generated files are written under ./multix-output/ unless MULTIX_OUTPUT_DIR or --output was used.",
    );
  }
  return lines.join("\n");
}

export interface MultixToolSpec<TParams extends TSchema> {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: TParams;
  /** Default wall-clock budget for this tool, before any per-call timeoutMs. */
  timeoutMs?: number;
  /** Pure argv builder, excluding common flags. Exported for tests. */
  build: (params: Static<TParams>) => string[];
}

/**
 * Build a pi tool that shells out to multix.
 *
 * Errors are signalled by throwing: pi only sets `isError` on a tool result for
 * a thrown error, never for a returned value.
 */
export function defineMultixTool<TParams extends TSchema>(spec: MultixToolSpec<TParams>) {
  type Params = Static<TParams>;

  const tool = defineTool<PiSchema, MultixDetails>({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    promptGuidelines: spec.promptGuidelines,
    // SAFETY: pi owns which TypeBox copy TypeScript sees (see "TypeBox identity"
    // above), so `TParams` and `PiSchema` are structurally identical but nominally
    // distinct. The schema is authored with TypeBox `Type` helpers and pi validates
    // arguments against it, so the value is correct at runtime; only the type
    // identity differs.
    parameters: spec.parameters as unknown as PiSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // SAFETY: pi validated `params` against `spec.parameters` before execute ran,
      // so it satisfies `Params`; this assertion only restores the nominal identity
      // that the cast above removed.
      const typed = params as unknown as Params & CommonParams;
      const argv = [...spec.build(typed), ...appendCommonInto(typed)];
      const cwd = typed.cwd ?? ctx.cwd;
      const timeoutMs = clampTimeout(typed.timeoutMs ?? spec.timeoutMs);

      const progress = (text: string): void =>
        onUpdate?.({ content: [{ type: "text", text }], details: { argv, phase: "running" } });

      progress(`multix ${argv.join(" ")}`);

      const result = await runMultix({
        args: argv,
        cwd,
        timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
        onOutput: (chunk) => progress(tail(chunk, MAX_STREAM_PREVIEW)),
      });

      const text = formatRunResult(result, cwd);
      if (result.exitCode !== 0) throw new Error(text);

      return {
        content: [{ type: "text", text }],
        details: {
          argv: result.argv,
          phase: "done" as const,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
      };
    },
  });

  // `build` and `timeoutMs` are attached for tests and documentation. pi only
  // reads the ToolDefinition fields, so extra properties are inert at runtime.
  return Object.assign(tool, {
    build: spec.build,
    timeoutMs: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}

function appendCommonInto(params: CommonParams): string[] {
  const argv: string[] = [];
  appendCommon(argv, params);
  return argv;
}
