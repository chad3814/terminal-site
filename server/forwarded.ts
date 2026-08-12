/**
 * Trusted-proxy checks for running behind a reverse proxy.
 *
 * The important rule here: **`X-Forwarded-For` is never the thing that
 * authorises a request.** It is client-supplied. nginx *appends* to it rather
 * than replacing it, so a client can send `X-Forwarded-For: 10.0.0.1` and have
 * its own value survive as the leftmost entry. Anything that trusted the
 * left-hand side of that header would hand a bypass to anyone who can reach
 * the port.
 *
 * The only unspoofable signal is the TCP peer — `req.socket.remoteAddress` —
 * because it is the address the kernel completed a handshake with. So:
 *
 *   1. `isTrustedPeer` gates the connection on the peer address.
 *   2. Only then is `clientAddress` used to work out who the real client is,
 *      by walking the forwarded chain right-to-left past hops we trust. That
 *      result is for logging and diagnostics, not for authorisation.
 *
 * IPv4 only, deliberately. Docker bridge networks are IPv4, and a
 * half-understood IPv6 parser on a security boundary is worse than an explicit
 * refusal: an address this module cannot parse is never trusted.
 */

/** An IPv4 network, held as a masked 32-bit base plus its mask. */
export interface Cidr {
  readonly base: number;
  readonly mask: number;
}

/** Used when TRUSTED_PROXIES is unset: only the local machine may connect. */
export const DEFAULT_TRUSTED_PROXIES = "127.0.0.0/8";

function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Reject "01", "+1", " 1" and other spellings Number() would accept, so
    // two different strings can never denote the same address.
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/**
 * Reduce an address to a plain IPv4 string, or null if it is not one.
 *
 * Node reports IPv4 peers on a dual-stack socket as `::ffff:127.0.0.1`, and
 * `::1` is the IPv6 loopback, which is the same machine as `127.0.0.1` for our
 * purposes. Everything else — real IPv6, garbage, undefined — is null, and
 * callers treat null as untrusted.
 */
export function normalizeAddress(address: string | undefined): string | null {
  if (address === undefined) return null;

  const trimmed = address.trim();
  if (trimmed === "") return null;
  if (trimmed === "::1") return "127.0.0.1";

  const mapped = /^::ffff:(.+)$/i.exec(trimmed);
  const candidate = mapped?.[1] ?? trimmed;

  return parseIpv4(candidate) === null ? null : candidate;
}

/** Parse one `a.b.c.d` or `a.b.c.d/len` entry. Throws on anything malformed. */
function parseCidr(text: string): Cidr {
  const [addressPart, lengthPart, ...rest] = text.split("/");
  if (addressPart === undefined || rest.length > 0) {
    throw new Error(`invalid CIDR in TRUSTED_PROXIES: ${JSON.stringify(text)}`);
  }

  const address = parseIpv4(addressPart);
  if (address === null) {
    throw new Error(`invalid IPv4 address in TRUSTED_PROXIES: ${JSON.stringify(text)}`);
  }

  let prefix = 32;
  if (lengthPart !== undefined) {
    if (!/^(0|[1-9][0-9]?)$/.test(lengthPart)) {
      throw new Error(`invalid prefix length in TRUSTED_PROXIES: ${JSON.stringify(text)}`);
    }
    prefix = Number(lengthPart);
    if (prefix > 32) {
      throw new Error(`prefix length above 32 in TRUSTED_PROXIES: ${JSON.stringify(text)}`);
    }
  }

  // `<<` is a 32-bit signed op in JS, and `-1 << 32` is -1 rather than 0, so
  // the /0 case is special-cased instead of relying on the shift.
  const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0;
  return { base: (address & mask) >>> 0, mask };
}

/**
 * Parse a comma-separated CIDR list.
 *
 * Throws rather than skipping bad entries. A typo in a trust list must stop
 * the server at boot: silently dropping the entry would leave the operator
 * believing a proxy is trusted when it is not, and silently widening is worse
 * still.
 */
export function parseTrustedProxies(spec: string | undefined): Cidr[] {
  const source = spec === undefined || spec.trim() === "" ? DEFAULT_TRUSTED_PROXIES : spec;
  const cidrs = source
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map(parseCidr);

  // `","` and friends are non-blank but parse to nothing, which would reject
  // every upgrade while looking configured. Fail closed *and* loudly.
  if (cidrs.length === 0) {
    throw new Error(`TRUSTED_PROXIES is set but lists no networks: ${JSON.stringify(spec)}`);
  }
  return cidrs;
}

/** Is this address inside any trusted network? Unparseable addresses are not. */
export function isTrustedPeer(
  address: string | undefined,
  trusted: readonly Cidr[],
): boolean {
  const normalized = normalizeAddress(address);
  if (normalized === null) return false;

  const value = parseIpv4(normalized);
  if (value === null) return false;

  return trusted.some((cidr) => ((value & cidr.mask) >>> 0) === cidr.base);
}

/**
 * Work out the real client address from the forwarded chain.
 *
 * The chain runs oldest-first: `X-Forwarded-For: <client>, <first proxy>`, with
 * the TCP peer as the newest hop of all. Walking from the newest end and
 * stepping over every hop we recognise as our own proxy, the first address we
 * do not trust is the furthest point we have any reason to believe — the
 * client. If every hop is trusted, the leftmost entry is the best answer.
 *
 * Returns null when nothing in the chain parses. **For logging only.**
 */
export function clientAddress(
  forwardedFor: string | undefined,
  peer: string | undefined,
  trusted: readonly Cidr[],
): string | null {
  const chain = (forwardedFor ?? "")
    .split(",")
    .map((entry) => normalizeAddress(entry))
    .filter((entry): entry is string => entry !== null);

  const peerAddress = normalizeAddress(peer);
  if (peerAddress !== null) chain.push(peerAddress);

  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const hop = chain[i];
    if (hop !== undefined && !isTrustedPeer(hop, trusted)) return hop;
  }

  return chain[0] ?? null;
}
