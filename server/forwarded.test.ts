import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUSTED_PROXIES,
  clientAddress,
  isTrustedPeer,
  normalizeAddress,
  parseTrustedProxies,
} from "./forwarded";

const DOCKER = parseTrustedProxies("172.16.0.0/12");
const LOOPBACK = parseTrustedProxies(undefined);

describe("normalizeAddress", () => {
  it("passes plain IPv4 through", () => {
    expect(normalizeAddress("192.168.1.10")).toBe("192.168.1.10");
  });

  it("unwraps the IPv4-mapped form Node reports on dual-stack sockets", () => {
    expect(normalizeAddress("::ffff:172.18.0.5")).toBe("172.18.0.5");
    expect(normalizeAddress("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });

  it("treats the IPv6 loopback as the same machine as 127.0.0.1", () => {
    expect(normalizeAddress("::1")).toBe("127.0.0.1");
  });

  it("returns null for anything it cannot read as IPv4", () => {
    for (const bad of [
      undefined,
      "",
      "   ",
      "not-an-ip",
      "2001:db8::1",
      "1.2.3",
      "1.2.3.4.5",
      "1.2.3.256",
      "1.2.3.-1",
      "1.2.3.4a",
    ]) {
      expect(normalizeAddress(bad)).toBeNull();
    }
  });

  it("rejects alternate spellings of the same octet", () => {
    // Two strings that denote one address would let a trust list be bypassed
    // by writing it differently.
    expect(normalizeAddress("127.0.0.01")).toBeNull();
    expect(normalizeAddress("0177.0.0.1")).toBeNull();
    expect(normalizeAddress(" 127.0.0.1")).toBe("127.0.0.1"); // outer trim only
  });
});

describe("parseTrustedProxies", () => {
  it("defaults to loopback when unset or blank", () => {
    expect(parseTrustedProxies(undefined)).toEqual(parseTrustedProxies(DEFAULT_TRUSTED_PROXIES));
    expect(parseTrustedProxies("   ")).toEqual(parseTrustedProxies(DEFAULT_TRUSTED_PROXIES));
  });

  it("accepts a comma-separated list with surrounding whitespace", () => {
    expect(parseTrustedProxies(" 10.0.0.0/8 , 172.18.0.0/16 ")).toHaveLength(2);
  });

  it("treats a bare address as a /32", () => {
    const single = parseTrustedProxies("172.18.0.5");
    expect(isTrustedPeer("172.18.0.5", single)).toBe(true);
    expect(isTrustedPeer("172.18.0.6", single)).toBe(false);
  });

  it("throws on a malformed entry rather than skipping it", () => {
    // Skipping would leave the operator believing a proxy is trusted when it
    // is not; the server must refuse to start instead.
    for (const bad of [
      "1.2.3",
      "1.2.3.4/33",
      "1.2.3.4/-1",
      "1.2.3.4/x",
      "1.2.3.4/8/8",
      "1.2.3.256/24",
      "nonsense",
    ]) {
      expect(() => parseTrustedProxies(bad)).toThrow();
    }
  });

  it("throws when set to something that lists no networks at all", () => {
    // Failing closed silently would reject every upgrade while looking configured.
    for (const bad of [",", " , ", ",,"]) {
      expect(() => parseTrustedProxies(bad)).toThrow(/lists no networks/);
    }
  });

  it("handles the /0 and /32 boundaries", () => {
    const all = parseTrustedProxies("0.0.0.0/0");
    expect(isTrustedPeer("8.8.8.8", all)).toBe(true);

    const exact = parseTrustedProxies("8.8.8.8/32");
    expect(isTrustedPeer("8.8.8.8", exact)).toBe(true);
    expect(isTrustedPeer("8.8.8.9", exact)).toBe(false);
  });
});

describe("isTrustedPeer", () => {
  it("matches inside the network and rejects outside it", () => {
    expect(isTrustedPeer("172.18.0.5", DOCKER)).toBe(true);
    expect(isTrustedPeer("172.31.255.254", DOCKER)).toBe(true);
    expect(isTrustedPeer("172.15.255.255", DOCKER)).toBe(false);
    expect(isTrustedPeer("172.32.0.0", DOCKER)).toBe(false);
    expect(isTrustedPeer("10.0.0.1", DOCKER)).toBe(false);
  });

  it("accepts the mapped form of a trusted address", () => {
    expect(isTrustedPeer("::ffff:172.18.0.5", DOCKER)).toBe(true);
  });

  it("fails closed on an address it cannot parse", () => {
    // A real IPv6 peer, a missing peer, or junk must never be trusted.
    for (const bad of [undefined, "", "2001:db8::1", "garbage"]) {
      expect(isTrustedPeer(bad, DOCKER)).toBe(false);
      expect(isTrustedPeer(bad, parseTrustedProxies("0.0.0.0/0"))).toBe(false);
    }
  });

  it("defaults to trusting only loopback", () => {
    expect(isTrustedPeer("127.0.0.1", LOOPBACK)).toBe(true);
    expect(isTrustedPeer("::1", LOOPBACK)).toBe(true);
    expect(isTrustedPeer("172.18.0.5", LOOPBACK)).toBe(false);
  });
});

describe("clientAddress", () => {
  it("returns the peer when there is no forwarded header", () => {
    expect(clientAddress(undefined, "203.0.113.9", DOCKER)).toBe("203.0.113.9");
  });

  it("skips trusted hops to find the real client", () => {
    // client -> edge proxy -> zeus proxy -> us
    expect(
      clientAddress("203.0.113.9, 172.18.0.2", "172.18.0.3", DOCKER),
    ).toBe("203.0.113.9");
  });

  it("ignores a spoofed left-hand entry when the client itself is untrusted", () => {
    // A client sending its own X-Forwarded-For gets appended to, so the
    // rightmost untrusted hop is the real one and the spoof is ignored.
    expect(
      clientAddress("1.2.3.4, 203.0.113.9, 172.18.0.2", "172.18.0.3", DOCKER),
    ).toBe("203.0.113.9");
  });

  it("does not let a spoofed header masquerade as a trusted proxy", () => {
    // Claiming to be the proxy does not make the real client trusted: the
    // untrusted peer is still what gets reported.
    expect(clientAddress("172.18.0.2", "203.0.113.9", DOCKER)).toBe("203.0.113.9");
  });

  it("falls back to the leftmost hop when every hop is trusted", () => {
    expect(clientAddress("172.18.0.9, 172.18.0.2", "172.18.0.3", DOCKER)).toBe("172.18.0.9");
  });

  it("skips unparseable entries rather than returning them", () => {
    expect(clientAddress("bogus, 203.0.113.9, 172.18.0.2", "172.18.0.3", DOCKER)).toBe(
      "203.0.113.9",
    );
    expect(clientAddress("unknown", undefined, DOCKER)).toBeNull();
  });

  it("returns null when there is nothing usable at all", () => {
    expect(clientAddress(undefined, undefined, DOCKER)).toBeNull();
  });
});
