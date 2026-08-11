import { describe, expect, it } from "vitest";
import { OSC_TITLE_MAX_BYTES, createTitleScanner } from "./osc-title";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("createTitleScanner", () => {
  it("reads a BEL-terminated title", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]0;zsh · cwalker\x07"))).toBe("zsh · cwalker");
  });

  it("reads an ST-terminated title", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]0;vim · notes\x1b\\"))).toBe("vim · notes");
  });

  it("accepts OSC 0, 1 and 2 but ignores other codes", () => {
    for (const code of [0, 1, 2]) {
      const scanner = createTitleScanner();
      expect(scanner.push(enc(`\x1b]${code};t\x07`))).toBe("t");
    }
    const scanner = createTitleScanner();
    // OSC 8 is a hyperlink, not a title.
    expect(scanner.push(enc("\x1b]8;;https://example.com\x07"))).toBeNull();
  });

  it("reassembles a sequence split across chunks, including mid-escape", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b"))).toBeNull();
    expect(scanner.push(enc("]0;sle"))).toBeNull();
    expect(scanner.push(enc("ep · tmp"))).toBeNull();
    expect(scanner.push(enc("\x07"))).toBe("sleep · tmp");
  });

  it("reassembles an ST terminator split across chunks", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]2;split\x1b"))).toBeNull();
    expect(scanner.push(enc("\\"))).toBe("split");
  });

  it("keeps multibyte UTF-8 intact when split mid-character", () => {
    const bytes = enc("\x1b]0;a · b\x07");
    const cut = 6; // lands inside the two-byte "·"
    const scanner = createTitleScanner();
    expect(scanner.push(bytes.slice(0, cut))).toBeNull();
    expect(scanner.push(bytes.slice(cut))).toBe("a · b");
  });

  it("returns the most recent title when a chunk carries several", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]0;first\x07 output \x1b]0;second\x07"))).toBe("second");
  });

  it("ignores ordinary output, including a bare ESC", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("plain text\r\n"))).toBeNull();
    expect(scanner.push(enc("\x1b[31mred\x1b[0m"))).toBeNull();
    expect(scanner.push(enc("\x1b"))).toBeNull();
    expect(scanner.push(enc("[2J"))).toBeNull();
  });

  it("passes an empty title through rather than dropping it", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]0;\x07"))).toBe("");
  });

  it("rejects a sequence with no Ps;Pt separator", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]0\x07"))).toBeNull();
  });

  it("abandons an unterminated sequence instead of buffering without limit", () => {
    const scanner = createTitleScanner();
    const huge = "\x1b]0;" + "x".repeat(OSC_TITLE_MAX_BYTES * 4);
    expect(scanner.push(enc(huge))).toBeNull();
    // Having given up, it must still recognise the next well-formed title
    // rather than staying wedged.
    expect(scanner.push(enc("\x1b]0;recovered\x07"))).toBe("recovered");
  });

  it("recovers when an ESC inside the body is not a terminator", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]0;bad\x1bX\x07"))).toBeNull();
    expect(scanner.push(enc("\x1b]0;good\x07"))).toBe("good");
  });

  it("drops a partial sequence on reset", () => {
    const scanner = createTitleScanner();
    expect(scanner.push(enc("\x1b]0;half"))).toBeNull();
    scanner.reset();
    // Without the reset the trailing BEL would complete the stale title.
    expect(scanner.push(enc(" done\x07"))).toBeNull();
  });
});
