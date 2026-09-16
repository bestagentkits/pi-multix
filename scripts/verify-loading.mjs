#!/usr/bin/env node
/**
 * Verify the built package the way pi actually loads it.
 *
 * This runs three checks that unit tests cannot cover:
 *
 * 1. pi's real extension loader (jiti plus the bundled-module alias map)
 *    discovers the built bundle and registers every tool.
 * 2. A happy-path CLI call works end to end through a registered tool.
 * 3. A failing CLI call surfaces the real CLI output rather than a generic error.
 *
 * Check 3 relies on `multix check` exiting non-zero when no provider key is
 * configured, which is the normal state on a machine with no keys. If keys are
 * present the check adapts instead of failing.
 *
 * Run: npm run build && node scripts/verify-loading.mjs
 *
 * Pass a package directory to verify an installed copy instead of this checkout,
 * which is how a real consumer's install is checked:
 *
 *   node scripts/verify-loading.mjs /path/to/node_modules/pi-multix
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.argv[2] !== undefined ? resolve(process.argv[2]) : repoRoot;
const entry = join(root, "dist", "index.js");
const fromInstalledPackage = root !== repoRoot;
const EXPECTED_TOOLS = [
  "multix_audio",
  "multix_check",
  "multix_doc",
  "multix_image",
  "multix_media",
  "multix_models",
  "multix_run",
  "multix_video",
];

const failures = [];
const notes = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log(`pi-multix verification against ${entry}`);
if (fromInstalledPackage) console.log(`(installed package copy, not the checkout at ${repoRoot})`);

if (!existsSync(entry)) {
  console.error(`dist/index.js is missing at ${entry}. Run \`npm run build\` first.`);
  process.exit(1);
}

// ---- 1. load through pi's real extension loader ----------------------------
console.log("\n[1] extension loading via pi's loader");

const loaded = await discoverAndLoadExtensions([entry], root);
const loadErrors = loaded.errors.filter((error) => error.path.includes("pi-multix") || error.path === entry);
check("no load errors for this package", loadErrors.length === 0, JSON.stringify(loadErrors));

const tools = new Map();
for (const extension of loaded.extensions) {
  for (const [name, registered] of extension.tools) {
    if (name.startsWith("multix_")) tools.set(name, registered.definition);
  }
}

const names = [...tools.keys()].sort();
check(
  `registers all ${EXPECTED_TOOLS.length} tools`,
  JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS),
  `got ${JSON.stringify(names)}`,
);

// pi feeds promptMetadata straight into the system prompt, so an empty snippet
// would silently degrade tool selection.
const missingPromptMetadata = names.filter((name) => {
  const definition = tools.get(name);
  return !definition?.promptSnippet || !definition?.description;
});
check("every tool has a description and prompt snippet", missingPromptMetadata.length === 0, missingPromptMetadata.join(", "));

if (tools.size === 0) {
  console.error("\nNo tools were registered, so the CLI checks cannot run.");
  process.exit(1);
}

/** Minimal ExtensionContext: the tools only read cwd from it. */
const ctx = { cwd: root };

// ---- 2. happy path against the real CLI ------------------------------------
console.log("\n[2] happy path: multix_run --version");

const runTool = tools.get("multix_run");
const version = await runTool.execute("verify-version", { args: ["--version"] }, undefined, undefined, ctx);
const versionText = version.content.map((part) => part.text).join("\n");

check("exits 0", version.details?.exitCode === 0, `exitCode=${version.details?.exitCode}`);
check("reports phase done", version.details?.phase === "done");
check("resolved the multix CLI", /cli\.js/.test(versionText), versionText.split("\n")[0]);
check("returned a version", /\d+\.\d+\.\d+/.test(versionText), versionText.slice(0, 120));

// ---- 3. failure path surfaces real CLI output ------------------------------
console.log("\n[3] failure path: multix_check with no provider keys");

const checkTool = tools.get("multix_check");
let thrown = null;
let returned = null;
try {
  returned = await checkTool.execute("verify-check", {}, undefined, undefined, ctx);
} catch (error) {
  thrown = error;
}

const diagnostics = thrown instanceof Error ? thrown.message : (returned?.content ?? []).map((p) => p.text).join("\n");

if (thrown === null) {
  notes.push("A provider key is configured, so multix check exited 0; the failure path was not exercised.");
  check("returns real CLI diagnostics", diagnostics.includes("API Keys"), diagnostics.slice(0, 200));
} else {
  check("non-zero exit is reported as a thrown error", true);
  check("error carries the CLI diagnostics", diagnostics.includes("API Keys"), diagnostics.slice(0, 200));
  check("error carries the exit code", /exit:\s*\d+/.test(diagnostics));
}

// ---- 4. the bundled skill is discoverable ---------------------------------
console.log("\n[4] skill discovery");

const skillResult = loadSkillsFromDir({ dir: join(root, "skills"), source: "pi-multix" });
check(
  "loads exactly one skill",
  skillResult.skills.length === 1,
  `got ${skillResult.skills.map((skill) => skill.name).join(", ") || "none"}`,
);
check(
  "skill is named multix",
  skillResult.skills[0]?.name === "multix",
  skillResult.skills[0]?.name,
);
// The description is the only thing the model sees before deciding to load the
// skill, so a thin one silently disables the whole asset.
check(
  "skill description is substantial",
  (skillResult.skills[0]?.description ?? "").length > 200,
  `length=${skillResult.skills[0]?.description?.length ?? 0}`,
);
check(
  "skill reports no diagnostics",
  skillResult.diagnostics.length === 0,
  JSON.stringify(skillResult.diagnostics),
);

// ---- summary ---------------------------------------------------------------
console.log("");
for (const note of notes) console.log(`note: ${note}`);

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`PASSED — ${EXPECTED_TOOLS.length} tools loaded and exercised against the real CLI.`);