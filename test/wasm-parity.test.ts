import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const VENDORED = "public/ghostty-vt.wasm";
const INSTALLED = "node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm";

describe("vendored ghostty wasm", () => {
  it("is byte-identical to the installed @wterm/ghostty binary", async () => {
    const [vendored, installed] = await Promise.all([
      readFile(VENDORED),
      readFile(INSTALLED),
    ]);
    expect(vendored.equals(installed)).toBe(true);
  });

  it("is a real wasm module", async () => {
    const vendored = await readFile(VENDORED);
    expect([...vendored.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });
});
