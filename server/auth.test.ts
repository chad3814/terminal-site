import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { allowedOrigins, isOriginAllowed, isTokenValid } from "./auth";

describe("allowedOrigins", () => {
  it("derives both loopback spellings from the configured port", () => {
    expect(allowedOrigins(3000)).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ]);
  });

  it("tracks a non-default port so PORT cannot lock the app out", () => {
    expect(allowedOrigins(4100)).toEqual([
      "http://127.0.0.1:4100",
      "http://localhost:4100",
    ]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = allowedOrigins(3000);

  it("accepts an exact loopback origin", () => {
    expect(isOriginAllowed("http://127.0.0.1:3000", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);
  });

  it("rejects a missing origin", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(false);
    expect(isOriginAllowed("", allowed)).toBe(false);
  });

  it("rejects other origins, ports, and schemes", () => {
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:3001", allowed)).toBe(false);
    expect(isOriginAllowed("https://localhost:3000", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:3000.evil.example", allowed)).toBe(false);
  });
});

describe("isTokenValid", () => {
  it("accepts an exact match", () => {
    expect(isTokenValid("s3cret", "s3cret")).toBe(true);
  });

  it("rejects wrong values and wrong lengths without throwing", () => {
    expect(isTokenValid("s3cret", "s3cres")).toBe(false);
    expect(isTokenValid("", "s3cret")).toBe(false);
    expect(isTokenValid("s3cret-and-then-some", "s3cret")).toBe(false);
  });

  describe("timing-safe comparison pinning", () => {
    it("implements length guard before timing-safe comparison", () => {
      // crypto.timingSafeEqual throws if buffers have different lengths.
      // This test verifies the length guard works: if isTokenValid returns false
      // instead of throwing, the length check is in place.
      const result = isTokenValid("x", "much-longer");
      expect(result).toBe(false);
    });

    it("compares with crypto.timingSafeEqual, not a short-circuiting operator", async () => {
      // Timing-safe comparison cannot be observed through return values alone:
      // both crypto.timingSafeEqual and === return identical booleans for the
      // same inputs. This test pins the security property by asserting on the
      // implementation itself — the only honest way to verify *which function*
      // is being called. This coupling is justified precisely because the
      // security property lives in the call site, not in the result.
      const source = await readFile("server/auth.ts", "utf8");
      expect(source).toMatch(
        /import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from\s*["']node:crypto["']/,
      );
      const body = source.slice(source.indexOf("export function isTokenValid"));
      expect(body).toContain("timingSafeEqual(");
      expect(body).not.toMatch(/provided\s*===\s*expected/);
    });
  });
});
