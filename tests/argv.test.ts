import { describe, expect, it } from "vitest";
import { flag, isProvided, repeat, variadic } from "../src/multix/argv.js";

describe("isProvided", () => {
  it("treats absent and blank values as not provided", () => {
    expect(isProvided(undefined)).toBe(false);
    expect(isProvided(null)).toBe(false);
    expect(isProvided("")).toBe(false);
    expect(isProvided("   ")).toBe(false);
    expect(isProvided([])).toBe(false);
  });

  it("treats real values as provided, including false and zero", () => {
    expect(isProvided("x")).toBe(true);
    expect(isProvided(0)).toBe(true);
    expect(isProvided(false)).toBe(true);
    expect(isProvided(["a"])).toBe(true);
  });
});

describe("flag", () => {
  it("pushes name and stringified value", () => {
    const argv: string[] = [];
    flag(argv, "--num-images", 3);
    flag(argv, "--model", "veo");
    expect(argv).toEqual(["--num-images", "3", "--model", "veo"]);
  });

  it("omits absent and blank scalars", () => {
    const argv: string[] = [];
    flag(argv, "--model", undefined);
    flag(argv, "--model", null);
    flag(argv, "--model", "");
    flag(argv, "--model", "  ");
    expect(argv).toEqual([]);
  });

  it("treats a boolean as a switch and never renders false", () => {
    const argv: string[] = [];
    flag(argv, "--wait", true);
    flag(argv, "--download", false);
    flag(argv, "--async", undefined);
    expect(argv).toEqual(["--wait"]);
  });
});

describe("repeat", () => {
  it("emits the flag once per value", () => {
    const argv: string[] = [];
    repeat(argv, "--ref", ["a.png", "b.png"]);
    expect(argv).toEqual(["--ref", "a.png", "--ref", "b.png"]);
  });

  it("skips blanks and handles undefined", () => {
    const argv: string[] = [];
    repeat(argv, "--ref", ["a.png", "  "]);
    repeat(argv, "--ref", undefined);
    expect(argv).toEqual(["--ref", "a.png"]);
  });
});

describe("variadic", () => {
  it("emits one flag followed by every value", () => {
    const argv: string[] = [];
    variadic(argv, "--files", ["a.mp3", "b.mp3"]);
    expect(argv).toEqual(["--files", "a.mp3", "b.mp3"]);
  });

  it("emits nothing for an empty list", () => {
    const argv: string[] = [];
    variadic(argv, "--files", []);
    variadic(argv, "--files", undefined);
    expect(argv).toEqual([]);
  });
});
