import { describe, expect, it } from "vitest";
import { routeUpgrade } from "./upgrade";

describe("routeUpgrade", () => {
  it("routes a trusted peer's terminal upgrade to the terminal", () => {
    expect(routeUpgrade({ pathname: "/api/terminal", peerTrusted: true, dev: false })).toBe(
      "terminal",
    );
  });

  it("rejects an untrusted peer whatever path it asks for", () => {
    // The original defect: the path was dispatched before the peer was
    // checked, so anything other than /api/terminal skipped the check.
    for (const pathname of ["/api/terminal", "/_next/webpack-hmr", "/leaktest", "/", null]) {
      for (const dev of [true, false]) {
        expect(routeUpgrade({ pathname, peerTrusted: false, dev })).toBe("reject");
      }
    }
  });

  it("never hands an unknown path to the framework in production", () => {
    // Next's production handleUpgrade() is an empty function: it neither
    // responds nor destroys, so the socket stays open forever. Enough of
    // those exhausts the process's file descriptors.
    for (const pathname of ["/_next/webpack-hmr", "/leaktest", "/", null]) {
      expect(routeUpgrade({ pathname, peerTrusted: true, dev: false })).toBe("reject");
    }
  });

  it("still forwards HMR to the framework in dev", () => {
    expect(routeUpgrade({ pathname: "/_next/webpack-hmr", peerTrusted: true, dev: true })).toBe(
      "framework",
    );
  });

  it("does not treat a prefix or suffix of the terminal path as the terminal", () => {
    for (const pathname of [
      "/api/terminals",
      "/api/terminal/",
      "/api/terminal/extra",
      "/API/TERMINAL",
      "/x/api/terminal",
    ]) {
      expect(routeUpgrade({ pathname, peerTrusted: true, dev: false })).toBe("reject");
    }
  });
});
