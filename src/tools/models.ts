/**
 * `multix_models` — provider inventory, model listing, and API key management.
 *
 * ## Why this tool cannot accept a key as a string
 *
 * pi persists tool call arguments in its session log, and every tool argument is
 * also part of the conversation sent to the model provider. A secret passed as a
 * parameter would therefore be written to disk in plaintext and transmitted to a
 * third party. This tool refuses to take that path: the schema has no parameter
 * that can hold a key.
 *
 * A key reaches `~/.multix/.env` in one of two ways instead:
 *
 * - The user stages it themselves. `scaffold` writes the file with the right
 *   variable names and owner-only permissions, and prints a shell incantation
 *   that reads the secret without echoing it or putting it in shell history.
 * - The user puts the secret somewhere this process can already see it — an
 *   environment variable, or a file they created — and passes only its *name* or
 *   *path*. The value is read, written, and never returned.
 *
 * Either way the value never appears in a tool argument, a tool result, or a log.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { Type, type Static } from "typebox";
import { flag } from "../multix/argv.js";
import {
  assertKnownVariable,
  envFilePath,
  importSecret,
  isSecretVariable,
  KNOWN_VARIABLES,
  permissionWarning,
  PROVIDERS,
  PROVIDER_IDS,
  readEnvFile,
  removeSecret,
  scaffoldEnvFile,
  type ProviderId,
} from "../multix/env-file.js";import { clampTimeout, DEFAULT_TIMEOUT_MS, runMultix } from "../multix/runner.js";
import { appendCommon, CommonFields, formatRunResult, type CommonParams } from "./shared.js";

/** Providers that can list their models from the CLI, and the kind each lists. */
const MODEL_COMMANDS: Partial<Record<ProviderId, Partial<Record<string, string[]>>>> = {
  leonardo: {
    image: ["leonardo", "models"],
    video: ["leonardo", "video-models"],
  },
  openrouter: {
    video: ["openrouter", "video-models"],
  },
  elevenlabs: {
    model: ["elevenlabs", "models"],
    voice: ["elevenlabs", "voices"],
  },
};

/** Default listing kind per provider, so callers can omit it. */
const DEFAULT_KIND: Partial<Record<ProviderId, string>> = {
  leonardo: "image",
  openrouter: "video",
  elevenlabs: "model",
};

const parameters = Type.Object({
  action: StringEnum(["providers", "models", "scaffold", "set-key", "unset-key"] as const, {
    description:
      "providers lists every supported provider, its environment variable names, and which are configured. models lists models from the CLI. scaffold creates ~/.multix/.env with placeholders. set-key imports a key from an environment variable or a file. unset-key removes one.",
  }),
  provider: Type.Optional(
    StringEnum(PROVIDER_IDS, {
      description: "Provider to act on, for action=models or action=scaffold.",
    }),
  ),
  variable: Type.Optional(
    Type.String({
      description:
        "Exact environment variable name to set or remove, for example GEMINI_API_KEY. Call action=providers to see the names. Unknown names are rejected.",
    }),
  ),
  fromEnv: Type.Optional(
    Type.String({
      description:
        "set-key source: name of an environment variable already present in this process. Only the name is passed, never the value.",
    }),
  ),
  fromFile: Type.Optional(
    Type.String({
      description:
        "set-key source: path to a file whose contents are the key. Only the path is passed; the value is read from disk and never returned.",
    }),
  ),
  consume: Type.Optional(
    Type.Boolean({
      description: "set-key with fromFile: delete the source file after importing it successfully.",
    }),
  ),
  overwrite: Type.Optional(
    Type.Boolean({ description: "Allow replacing a variable that already holds a value." }),
  ),
  kind: Type.Optional(
    StringEnum(["image", "video", "voice", "model"] as const, {
      description:
        "models: which catalogue to list. Defaults to image for leonardo, video for openrouter, and model for elevenlabs.",
    }),
  ),
  ...CommonFields,
});

type ModelsParams = Static<typeof parameters>;

/** Text used to point a user at the non-echoing way to enter a key by hand. */
function manualInstructions(variable: string): string {
  return [
    `To enter ${variable} by hand without exposing it to the model, in your own terminal:`,
    "",
    `  read -rs KEY && printf '${variable}=%s\\n' "$KEY" >> ${envFilePath()}`,
    "",
    "The read prompt keeps it off the screen and out of shell history. Then run multix_check to confirm.",
  ].join("\n");
}

function resolveSecretSource(params: ModelsParams): { origin: string; value: string } {
  const fromEnv = params.fromEnv?.trim() ?? "";
  const fromFile = params.fromFile?.trim() ?? "";

  if (fromEnv !== "" && fromFile !== "") {
    throw new Error("multix_models: pass either fromEnv or fromFile, not both.");
  }
  if (fromEnv !== "") {
    const value = process.env[fromEnv];
    if (value === undefined || value.trim() === "") {
      throw new Error(
        `multix_models: environment variable ${fromEnv} is empty or not set in the process running pi. ` +
          "Export it before starting pi, or use fromFile instead.",
      );
    }
    return { origin: `env:${fromEnv}`, value: value.trim() };
  }
  if (fromFile !== "") {
    if (!existsSync(fromFile)) throw new Error(`multix_models: file not found: ${fromFile}`);
    const value = readFileSync(fromFile, "utf8").trim();
    if (value === "") throw new Error(`multix_models: file is empty: ${fromFile}`);
    return { origin: `file:${fromFile}`, value };
  }
  throw new Error(
    "multix_models: set-key needs a source. Pass fromEnv with the name of an environment variable, " +
      "or fromFile with a path to a file holding the key. No parameter accepts the key itself, because " +
      "tool arguments are written to the pi session log and sent to the model provider.\n\n" +
      manualInstructions(params.variable ?? "<VARIABLE>"),
  );
}

function describeProviders(): string {
  const snapshot = readEnvFile();
  const lines = [
    `Config file: ${snapshot.path} (${snapshot.exists ? "exists" : "not created yet"})`,
    "",
    "multix resolves configuration in this order: process.env, then <cwd>/.env, then this file.",
    "",
  ];
  for (const provider of PROVIDER_IDS) {
    const { label, variables } = PROVIDERS[provider];
    lines.push(`${label} (${provider})`);
    for (const name of variables) {
      const inFile = snapshot.configured.includes(name) ? "set" : "unset";
      const inEnv = process.env[name]?.trim() ? "set" : "unset";
      const kind = isSecretVariable(name) ? "secret" : "identifier";
      lines.push(`  ${name}  file=${inFile} process.env=${inEnv}  (${kind})`);
    }
  }
  // A file the user edited by hand inherits their umask, which is often 644.
  const warning = permissionWarning(snapshot.path);
  if (warning !== null) lines.push("", warning);

  lines.push(
    "",
    "Values are never displayed. Use action=scaffold to create the file with placeholders,",
    "or action=set-key with fromEnv or fromFile to import a key without passing it as a parameter.",
  );
  return lines.join("\n");
}

async function listModels(
  params: ModelsParams,
  ctxCwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const provider = params.provider;
  if (provider === undefined) {
    throw new Error(
      `multix_models: provider is required for action=models. Providers that can list models: ${Object.keys(MODEL_COMMANDS).join(", ")}.`,
    );
  }
  const available = MODEL_COMMANDS[provider];
  if (available === undefined) {
    throw new Error(
      `multix_models: ${provider} has no model listing command. Providers that do: ${Object.keys(MODEL_COMMANDS).join(", ")}. ` +
        "For a fixed model id, use multix_run or pass model explicitly to the capability tools.",
    );
  }
  const kind = params.kind ?? DEFAULT_KIND[provider];
  const argv = kind === undefined ? undefined : available[kind];
  if (argv === undefined) {
    throw new Error(
      `multix_models: ${provider} cannot list kind=${kind}. Available: ${Object.keys(available).join(", ")}.`,
    );
  }

  const full = [...argv];
  const common = params as CommonParams;
  flag(full, "--verbose", common.verbose);
  appendCommon(full, { ...common, verbose: false });

  const cwd = common.cwd ?? ctxCwd;
  const result = await runMultix({
    args: full,
    cwd,
    timeoutMs: clampTimeout(common.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(signal === undefined ? {} : { signal }),
  });
  const text = formatRunResult(result, cwd);
  if (result.exitCode !== 0) throw new Error(text);
  return text;
}

function setKey(params: ModelsParams): string {
  if (params.variable === undefined || params.variable.trim() === "") {
    throw new Error(
      `multix_models: variable is required for action=set-key. Known variables: ${KNOWN_VARIABLES.join(", ")}.`,
    );
  }
  const variable = params.variable.trim();
  // Validate the name before reading any source, so an unknown variable can
  // never cause a secret to be read unnecessarily.
  assertKnownVariable(variable);
  const { origin, value } = resolveSecretSource(params);
  const { path, outcome } = importSecret({
    variable,
    value,
    ...(params.overwrite === undefined ? {} : { overwrite: params.overwrite }),
  });

  let consumed = "";
  if (params.consume === true && origin.startsWith("file:")) {
    const sourcePath = origin.slice("file:".length);
    try {
      unlinkSync(sourcePath);
      consumed = `\nSource file deleted: ${sourcePath}`;
    } catch (error) {
      consumed = `\nWARNING: could not delete ${sourcePath}: ${(error as Error).message}`;
    }
  }

  return [
    `multix_models: ${variable} ${outcome}`,
    `file: ${path} (mode 600)`,
    `source: ${origin}`,
    "value: not displayed, and never passed as a tool argument",
    "",
    "The multix CLI reads this file on every invocation, so no restart is needed. Run multix_check to confirm." +
      consumed,
  ].join("\n");
}

function unsetKey(params: ModelsParams): string {
  if (params.variable === undefined || params.variable.trim() === "") {
    throw new Error("multix_models: variable is required for action=unset-key.");
  }
  const variable = params.variable.trim();
  const { path, removed } = removeSecret({ variable });
  if (removed === 0) return `multix_models: ${variable} was not set in ${path}. Nothing changed.`;
  return `multix_models: removed ${removed} assignment(s) of ${variable} from ${path}.`;
}

const modelsToolBase = defineTool({
  name: "multix_models",
  label: "Multix Models & Keys",
  description:
    "Inspect multix providers and their model catalogues, and manage the provider credentials in ~/.multix/.env. This tool never accepts a key as a string: tool arguments are written to the pi session log and sent to the model provider, so set-key imports a key from an environment variable name or a file path instead, and scaffold creates the file for the user to fill in themselves. Values are never displayed back.",
  promptSnippet:
    "List multix providers and models, and manage provider keys in ~/.multix/.env without handling secrets",
  promptGuidelines: [
    "Never ask the user to paste an API key into the conversation. Use multix_models with action=scaffold so they can enter it themselves, or action=set-key with fromEnv or fromFile so only a name or path is passed.",
    "Use multix_models with action=providers to see which provider credentials are configured before choosing a provider for a multix image, video, audio, or document task.",
    "Use multix_models with action=models to list the real model ids a provider offers before passing model to multix_image or multix_video.",
    "Use multix_check, not multix_models, to run the CLI's own diagnostics after a key is added.",
  ],
  parameters,
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const action = params.action;

    if (action === "providers") return { content: [{ type: "text", text: describeProviders() }], details: {} };
    if (action === "scaffold") {
      const provider = params.provider;
      const variables =
        provider !== undefined
          ? [...PROVIDERS[provider].variables]
          : [...KNOWN_VARIABLES];
      const result = scaffoldEnvFile(variables);
      const text = [
        `multix_models: scaffolded ${result.path}`,
        `file ${result.created ? "created" : "updated"} with mode 600`,
        result.placeholders.length > 0
          ? `placeholders added: ${result.placeholders.join(", ")}`
          : "no placeholders needed; every requested variable already had an entry",
        "",
        "Existing values were left untouched. To fill one in without exposing it:",
        "",
        result.placeholders.length > 0
          ? manualInstructions(result.placeholders[0] ?? "<VARIABLE>")
          : manualInstructions("<VARIABLE>"),
      ].join("\n");
      return { content: [{ type: "text", text }], details: {} };
    }
    if (action === "set-key") return { content: [{ type: "text", text: setKey(params) }], details: {} };
    if (action === "unset-key") return { content: [{ type: "text", text: unsetKey(params) }], details: {} };

    const text = await listModels(params, ctx.cwd, signal);
    return { content: [{ type: "text", text }], details: {} };
  },
});

/**
 * `timeoutMs` is attached so the tool carries a wall-clock budget like the other
 * multix tools. Only the `models` action shells out; the key actions never touch
 * the network.
 */
export const modelsTool = Object.assign(modelsToolBase, {
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
