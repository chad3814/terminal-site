import { timingSafeEqual } from "node:crypto";

/**
 * The allowlist is derived from the configured port rather than hardcoded,
 * so setting PORT cannot lock the app out of its own WebSocket.
 */
export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/**
 * Resolve the allowlist, letting a deployment behind a reverse proxy name the
 * public origins explicitly.
 *
 * Behind a proxy the browser sends the *public* origin — `https://x.example` —
 * not the loopback address this process is listening on, so the derived list
 * would reject every upgrade. `spec` is a comma-separated list of exact
 * origins.
 *
 * Exact strings only: no wildcards, no suffix matching. This is the check that
 * stops a page you happen to visit opening a socket to a shell, and pattern
 * matching on origins is where that kind of check usually goes wrong
 * (`https://evil-example.com` matching a naive `example.com` suffix rule).
 * Each entry must be a bare scheme://host[:port] with no path, and a malformed
 * entry throws rather than being dropped — a trust list that silently ignores
 * what it cannot read is worse than one that refuses to start.
 */
export function configuredOrigins(spec: string | undefined, port: number): string[] {
  if (spec === undefined || spec.trim() === "") return allowedOrigins(port);

  const origins = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      // `https://*.example` is a valid URL whose origin is itself, so it would
      // pass every check below and then match nothing, since comparison is
      // exact. Someone writing that means "any subdomain" and would get a
      // silently dead allowlist. Refuse it instead of pretending.
      if (entry.includes("*")) {
        throw new Error(
          `wildcards are not supported in ALLOWED_ORIGINS, list each origin: ${JSON.stringify(entry)}`,
        );
      }

      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        throw new Error(`invalid origin in ALLOWED_ORIGINS: ${JSON.stringify(entry)}`);
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`origin must be http or https: ${JSON.stringify(entry)}`);
      }
      // `new URL("https://x.example/path").origin` silently drops the path, so
      // an entry with one would be accepted while not meaning what it says.
      if (url.origin !== entry.replace(/\/$/, "")) {
        throw new Error(
          `origin must be scheme://host[:port] with no path: ${JSON.stringify(entry)}`,
        );
      }
      return url.origin;
    });

  // Same trap as an empty trusted-proxy list: non-blank but yields nothing, so
  // every upgrade would 403 while the config looks present.
  if (origins.length === 0) {
    throw new Error(`ALLOWED_ORIGINS is set but lists no origins: ${JSON.stringify(spec)}`);
  }
  return origins;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined || origin === "") return false;
  return allowed.includes(origin);
}

export function isTokenValid(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
