/**
 * Execute the multix CLI as a child process.
 *
 * The CLI is always spawned with `execFile` and an argv array — never through a
 * shell — so prompts, file paths, and URLs supplied by the model cannot be
 * interpreted as shell syntax.
 */

import { execFile } from "node:child_process";
import { resolveMultixCommand } from "./resolve.js";

/** Default wall-clock budget for a single multix invocation. */
export const DEFAULT_TIMEOUT_MS = 600_000;

/** Upper bound accepted from tool parameters, so a runaway job cannot hang a session. */
export const MAX_TIMEOUT_MS = 3_600_000;

const MIN_TIMEOUT_MS = 1_000;

/** 32 MiB covers a verbose `multix check` or a long provider error dump. */
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export interface MultixRunResult {
  /** Fully resolved argv, including the script path when the dependency was used. */
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

export interface RunMultixOptions {
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called with each stdout/stderr chunk so the caller can stream progress. */
  onOutput?: (chunk: string) => void;
}

export function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(timeoutMs), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

const MISSING_CLI_MESSAGE = [
  "multix CLI not found.",
  "Install it with `npm install @mrgoonie/multix` in the project, install it globally",
  "(`npm install -g @mrgoonie/multix`), or point MULTIX_BIN at the multix CLI entry point.",
].join(" ");

/**
 * Run multix and resolve with a normalized result. Never rejects for a non-zero
 * exit code — the caller decides whether that is a tool error. Rejects only when
 * the CLI cannot be located at all.
 */
export function runMultix(options: RunMultixOptions): Promise<MultixRunResult> {
  const resolved = resolveMultixCommand({ cwd: options.cwd });
  if (resolved === null) return Promise.reject(new Error(MISSING_CLI_MESSAGE));

  const argv = [...resolved.prefixArgs, ...options.args];
  const timeout = clampTimeout(options.timeoutMs);
  const startedAt = Date.now();

  return new Promise<MultixRunResult>((resolve) => {
    const child = execFile(
      resolved.command,
      argv,
      {
        cwd: options.cwd,
        timeout,
        maxBuffer: MAX_BUFFER_BYTES,
        encoding: "utf8",
        env: process.env,
        windowsHide: true,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        const failure = error as
          | (Error & { code?: string | number | null; killed?: boolean })
          | null;
        const aborted = error?.name === "AbortError" || options.signal?.aborted === true;
        resolve({
          argv,
          exitCode: failure === null ? 0 : typeof failure.code === "number" ? failure.code : 1,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          durationMs: Date.now() - startedAt,
          timedOut: failure?.killed === true && !aborted,
          aborted,
        });
      },
    );

    if (options.onOutput !== undefined) {
      const forward = (chunk: string): void => options.onOutput?.(chunk);
      child.stdout?.on("data", forward);
      child.stderr?.on("data", forward);
    }
  });
}
