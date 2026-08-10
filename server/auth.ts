import { timingSafeEqual } from "node:crypto";

/**
 * The allowlist is derived from the configured port rather than hardcoded,
 * so setting PORT cannot lock the app out of its own WebSocket.
 */
export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
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
