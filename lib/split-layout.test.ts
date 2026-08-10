import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT,
  clampSplit,
  gridTemplate,
  nudgeSplit,
  parseStoredSplit,
  serializeSplit,
  splitFromPointer,
} from "./split-layout";

describe("clampSplit", () => {
  it("clamps to the 10-90 range", () => {
    expect(clampSplit(50)).toBe(50);
    expect(clampSplit(0)).toBe(10);
    expect(clampSplit(100)).toBe(90);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampSplit(Number.NaN)).toBe(DEFAULT_SPLIT.col);
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(90);
  });
});

describe("splitFromPointer", () => {
  it("converts a pointer position into a percentage", () => {
    expect(splitFromPointer(250, 0, 1000)).toBe(25);
    expect(splitFromPointer(700, 200, 1000)).toBe(50);
  });

  it("clamps rather than escaping the container", () => {
    expect(splitFromPointer(-100, 0, 1000)).toBe(10);
    expect(splitFromPointer(5000, 0, 1000)).toBe(90);
  });

  it("returns the default for a zero-size container", () => {
    expect(splitFromPointer(10, 0, 0)).toBe(DEFAULT_SPLIT.col);
  });
});

describe("nudgeSplit", () => {
  it("applies and clamps a delta", () => {
    expect(nudgeSplit(50, 1)).toBe(51);
    expect(nudgeSplit(50, -5)).toBe(45);
    expect(nudgeSplit(88, 5)).toBe(90);
    expect(nudgeSplit(12, -5)).toBe(10);
  });
});

describe("gridTemplate", () => {
  it("emits a three-track template with a fixed divider", () => {
    expect(gridTemplate(40)).toBe("40% 6px 1fr");
  });
});

describe("parseStoredSplit", () => {
  it("round-trips a serialized split", () => {
    const split = { col: 30, row: 70 };
    expect(parseStoredSplit(serializeSplit(split))).toEqual(split);
  });

  it("falls back to the default for missing or corrupt storage", () => {
    expect(parseStoredSplit(null)).toEqual(DEFAULT_SPLIT);
    expect(parseStoredSplit("nonsense")).toEqual(DEFAULT_SPLIT);
    expect(parseStoredSplit("[]")).toEqual(DEFAULT_SPLIT);
    expect(parseStoredSplit('{"col":"x","row":50}')).toEqual(DEFAULT_SPLIT);
  });

  it("clamps stored values that are out of range", () => {
    expect(parseStoredSplit('{"col":-40,"row":400}')).toEqual({ col: 10, row: 90 });
  });
});
