import type { JSX } from "react";
import { TerminalGrid } from "@/components/terminal-grid";
import { bootToken } from "@/server/token";

// This page embeds the per-process boot token. Prerendering it would bake in
// the token from build time and every WebSocket would fail auth under
// `next start`.
export const dynamic = "force-dynamic";

export default function Page(): JSX.Element {
  return <TerminalGrid token={bootToken()} />;
}
