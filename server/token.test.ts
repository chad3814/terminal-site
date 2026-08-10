import { describe, expect, it } from "vitest";
import { bootToken } from "./token";

describe("bootToken", () => {
  it("is stable within a process", () => {
    expect(bootToken()).toBe(bootToken());
  });

  it("is a long base64url string", () => {
    expect(bootToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
