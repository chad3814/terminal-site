/**
 * Where a WebSocket upgrade should go.
 *
 * Extracted from server.ts because the ordering here was a real defect: the
 * path was dispatched *before* the peer was checked, so an untrusted peer
 * asking to upgrade any path other than `/api/terminal` was handed straight to
 * Next's own upgrade handler. In production that handler is an empty function —
 * it neither responds nor destroys the socket — and Node applies no timeout to
 * an upgraded socket nobody owns. Sixty concurrent upgrades to unknown paths
 * stayed open indefinitely, so any peer that could reach the port could exhaust
 * the process's file descriptors and take the shells with it.
 *
 * As a pure function the ordering is testable, which is what was missing.
 */
export type UpgradeRoute = "terminal" | "framework" | "reject";

export interface UpgradeRequest {
  pathname: string | null;
  /** Whether the TCP peer is inside the trusted set. Never a forwarded header. */
  peerTrusted: boolean;
  /** Next serves its HMR socket only in dev; in production it has none. */
  dev: boolean;
}

export function routeUpgrade({ pathname, peerTrusted, dev }: UpgradeRequest): UpgradeRoute {
  // First, unconditionally. An untrusted peer gets no further regardless of
  // which path it asked for.
  if (!peerTrusted) return "reject";

  if (pathname === "/api/terminal") return "terminal";

  // Only dev has a framework socket worth forwarding (HMR). In production
  // there is nothing on the other end, so an unknown upgrade is closed rather
  // than left hanging.
  return dev ? "framework" : "reject";
}
