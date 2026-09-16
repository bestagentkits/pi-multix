/**
 * argv helpers for the multix CLI.
 *
 * multix parses argv with commander, so every value is passed as a discrete
 * argv entry and never through a shell. That keeps user/model supplied strings
 * from being interpreted as shell syntax.
 */

/** A value that has been supplied by the caller and is worth passing through. */
export function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Append `<name> <value>` for a scalar. Booleans act as switches: `true` pushes
 * the flag, `false` pushes nothing (commander's `--no-x` form needs its own
 * literal flag, which the tables express directly).
 */
export function flag(
  argv: string[],
  name: string,
  value: string | number | boolean | undefined | null,
): void {
  if (value === undefined || value === null) return;
  if (typeof value === "boolean") {
    if (value) argv.push(name);
    return;
  }
  if (typeof value === "string" && value.trim() === "") return;
  argv.push(name, String(value));
}

/** Append `<name> <value>` once per item, for repeatable options such as `--ref`. */
export function repeat(argv: string[], name: string, values: readonly string[] | undefined): void {
  for (const value of values ?? []) {
    if (typeof value === "string" && value.trim() !== "") argv.push(name, value);
  }
}

/**
 * Append `<name> v1 v2 ...` for commander variadic options such as
 * `--files <paths...>`. These are always emitted after scalar flags because a
 * variadic option is greedy up to the next `-`-prefixed token.
 */
export function variadic(argv: string[], name: string, values: readonly string[] | undefined): void {
  const list = (values ?? []).filter((value) => typeof value === "string" && value.trim() !== "");
  if (list.length === 0) return;
  argv.push(name, ...list);
}
