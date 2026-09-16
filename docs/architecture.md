# Architecture

How `pi-multix` turns the multix CLI into pi tools, and why it is built this way.

## Shape

```
src/index.ts            extension entry: registers the seven tools
src/multix/resolve.ts   locate the multix CLI
src/multix/runner.ts    spawn it and normalize the result
src/multix/argv.ts      argv helpers (flag, repeat, variadic)
src/tools/shared.ts     schemas, flag tables, validation, result formatting
src/tools/*.ts          one module per tool
skills/multix/SKILL.md  provider-selection guidance for the model
scripts/verify-loading.mjs  integration verification
```

The dependency direction is one-way: tools depend on `src/multix/*`, never the
reverse. Every CLI invocation is built by a pure `build(params) => string[]`
function, which is why the argument mapping is unit-testable without spawning a
process.

## Why shell out instead of importing multix

`@mrgoonie/multix` exposes a programmatic entry point, but it re-exports only
`./core`. Providers and command modules are not part of that contract, so using
them would mean deep imports into `dist/` and would break on the next internal
refactor.

The argv surface is the stable contract: it is documented in multix's own
`SKILL.md`, it is what the CLI's own tests exercise, and it covers every
provider uniformly. Wrapping argv therefore buys longevity at the cost of one
process spawn per call.

## Locating the CLI

`require.resolve("@mrgoonie/multix")` cannot be used. That package's `exports`
map declares only an `import` condition, so CommonJS resolution fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED` — and pi loads extensions through jiti, which may
present a module as CommonJS. Resolution therefore walks the filesystem for the
published bin path instead:

1. `MULTIX_BIN`, when set. An existing file is treated as a script and executed
   with `process.execPath`; anything else is treated as a command name.
2. Walk up from the extension directory looking for
   `node_modules/@mrgoonie/multix/dist/cli.js`.
3. Walk up from the tool's working directory.
4. A `multix` executable on `PATH`.

Walking up (rather than resolving one fixed relative path) covers both layouts pi
can produce: a dependency installed inside the package, and one hoisted to a
parent `node_modules`. Running the script with `process.execPath` also avoids
depending on the `.bin` shim, which matters on Windows.

## Executing

`execFile` with an argv array, never a shell string. Prompts, file paths, and
URLs supplied by the model therefore cannot be interpreted as shell syntax, and
`extraArgs` needs no quoting. `stdout` and `stderr` are streamed to the tool's
progress callback and collected for the final result. The timeout is clamped to
one hour so a runaway job cannot hold a session open indefinitely.

A non-zero exit is not treated as a transport error: the runner resolves
normally, and the tool layer throws an error carrying the exit code, stdout, and
stderr. Pi only marks a tool result as failed when `execute` throws, so throwing
is the only way to report a CLI failure honestly.

## argv construction

`src/tools/shared.ts` holds a parameter→flag table per provider and action. Two
properties matter:

- **Tables drive iteration, not the parameter object.** Argument order follows the
  table, so argv is identical regardless of the key order the model emitted. That
  keeps logs, tests, and command replay deterministic.
- **Variadic options are emitted last.** Commander's variadic options such as
  `--files <paths...>` are greedy up to the next `-`-prefixed token, so they are
  deferred until after every scalar flag.

Providers differ in ways a single schema cannot express, and the tables encode
that rather than hiding it:

- `leonardo generate <prompt>` and `leonardo video <prompt>` take the prompt
  positionally, while every other provider uses `--prompt`.
- Image-to-video takes the image positionally for gemini, leonardo, and byteplus,
  but as `--image-url` for openrouter.
- `leonardo i2i --ref` expects an existing Leonardo image id, not a file path.
- byteplus exposes audio as the pair `--audio` / `--no-audio` rather than one
  boolean, so it is handled outside the flag table.
- minimax and leonardo accept exactly one `--ref` for image editing.

Passing a parameter that the selected provider has no flag for is an error naming
the supported set. Silently dropping it would produce a wrong result that looks
successful.

## TypeBox type identity

pi aliases `typebox`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and
`@earendil-works/pi-coding-agent` to its own bundled copies when loading
extensions (see `VIRTUAL_MODULES` in pi's extension loader). At runtime there is
exactly one TypeBox instance, so schemas and pi's validator agree.

During local development npm also keeps a copy of `typebox` nested inside
`@earendil-works/pi-coding-agent`. Two physically distinct `TSchema` types then
exist, and TypeScript refuses to treat them as the same type even when the
versions match, because module identity follows the resolved file path.
`npm dedupe` does not remove that nested copy.

Rather than pin versions and hope, this package decouples from that identity: the
schemas are authored with TypeBox `Type` helpers (plain data, validated by pi),
and only the single hand-off into `defineTool` crosses the boundary, behind a
documented `SAFETY:` assertion in `src/tools/shared.ts`. Everything else —
including each tool's typed `build` function — stays fully type-checked.

Keep the `typebox` devDependency aligned with the version the targeted pi release
bundles (`1.3.7` for pi 0.85.1) so schema types match runtime behavior. The
`typebox` peer dependency is marked optional so npm never installs a second copy
next to the one pi provides.

## Verification strategy

Unit tests cover argument mapping, requirement validation, and CLI resolution,
including the failure paths: unsupported parameters, multiple references where a
provider allows one, and missing required arguments.

Unit tests cannot prove that pi's loader can load the bundle, because they run in
plain Node without jiti or the alias map. `scripts/verify-loading.mjs` closes that
gap by loading the built bundle through pi's real `discoverAndLoadExtensions`,
then exercising a registered tool against the real CLI on both the success and
failure paths, and confirming the bundled skill is discoverable.
