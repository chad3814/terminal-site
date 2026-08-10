# terminal-site — four resizable terminals

**Date:** 2026-08-10
**Status:** Approved, ready for implementation planning
**Branch:** `feat/four-terminals`

## Summary

A Next.js site showing four resizable terminal panes in a 2×2 grid. Each pane is a
live shell on the local machine, rendered by `@wterm/react` with the `@wterm/ghostty`
VT core and backed by a dedicated `tmux` session, so shells survive page reloads and
server restarts.

Modeled on [`vercel-labs/wterm/examples/local`](https://github.com/vercel-labs/wterm/tree/main/examples/local),
with three deliberate departures: the ghostty core instead of the built-in Zig core,
tmux-backed sessions instead of bare shells, and a typed control channel instead of
inline resize escape sequences.

## Goals

- Four independent shells, visible at once, in a 2×2 grid.
- Drag the cross-shaped divider to resize; the shells reflow to match.
- Shells persist across reload, server restart, and browser close.
- Safe to run on a personal machine without exposing a shell to the network.

## Non-goals

Explicitly out of scope. Each is a reasonable follow-up, none is in this build:

- Multiplexing all panes over one WebSocket.
- Any auth model beyond localhost (no users, no sessions, no sandboxing).
- A dynamic tmux-style split tree; the grid is fixed at four panes.
- Per-pane header chrome, theme switcher, `Cmd+1..4` focus shortcuts.
- Scrollback UI beyond what wterm and tmux copy-mode already provide.

## Threat model

The server spawns a login shell with the full user environment. Anyone who can reach
the port owns the machine. This is a personal, localhost-only tool, defended in two
layers:

1. **Bind + Origin allowlist.** The server listens on `127.0.0.1` only. WebSocket
   upgrades are rejected unless `Origin` is `http://127.0.0.1:<port>` or
   `http://localhost:<port>`. The allowlist is *derived from the configured host and
   port* rather than hardcoded to 3000, so setting `PORT` cannot silently lock the app
   out of its own socket. Browsers always send `Origin` on WebSocket upgrades, so
   this stops a page you happen to visit from opening a socket to your shell
   (cross-site WebSocket hijacking).
2. **Boot token.** 32 random bytes generated once per server process, embedded in the
   page by a Server Component and echoed back in the handshake. A cross-origin
   attacker cannot read our HTML, so it cannot produce the token. This covers the
   cases `Origin` does not: non-browser local clients, and DNS rebinding.

The README must state plainly that this exposes a shell and is localhost-only.

## Architecture

```
browser tab
├─ pane 0 ─ GhosttyCore #0 ─ WS ─┐
├─ pane 1 ─ GhosttyCore #1 ─ WS ─┤   text frame   = JSON control
├─ pane 2 ─ GhosttyCore #2 ─ WS ─┤   binary frame = raw PTY bytes
└─ pane 3 ─ GhosttyCore #3 ─ WS ─┘
                                 │
              server.ts (Next + ws, one process)
                                 │
   ┌─────────────┬───────────────┼───────────────┐
 PTY 0         PTY 1           PTY 2           PTY 3
   │             │               │               │
 tmux client   tmux client     tmux client     tmux client
   │             │               │               │
 termsite-0   termsite-1      termsite-2      termsite-3   ← outlive the browser
```

One WebSocket per pane, one PTY per socket, one tmux session per pane id. Panes are
fully independent: a crashed or restarted shell affects no other pane.

The bottom row is the point of the design. Closing a socket kills the tmux *client*,
never the session.

### Transport

WebSocket frame type selects the channel, so there is nothing to escape or
pattern-match:

- **Binary frames** — raw PTY bytes, both directions.
- **Text frames** — JSON control messages.

This replaces the example's `\x1b[RESIZE:80;24]` sequence embedded in the input
stream. That approach means pasted text containing the sequence is swallowed as a
resize instead of reaching the shell.

### Control messages

```jsonc
// client → server, required first frame
{ "type": "hello",  "token": "…", "pane": 0, "cols": 80, "rows": 24 }
{ "type": "resize", "cols": 100, "rows": 30 }

// server → client
{ "type": "ready" }
{ "type": "error", "message": "tmux not found on PATH" }
```

`hello` carries pane identity, credential, and initial size in one message, replacing
the example's query parameter plus separate initial resize. The token travels in the
frame rather than the URL so it stays out of access logs and browser history.

The server spawns nothing until a valid `hello` arrives. If none arrives within 5
seconds, the socket closes.

### Spawning

```
tmux new-session -A -D -s termsite-<pane>
```

- `-A` — attach if the session exists, create it otherwise.
- `-D` — detach any other client first, so the browser pane always owns sizing.
  Without this, tmux sizes the session to the smallest attached client and a stray
  terminal window elsewhere would shrink the browser pane.
- `termsite-` prefix — cannot collide with the user's own sessions.

Child environment: inherit `process.env`, then **delete `TMUX` and `TMUX_PANE`** and
pin `TERM=xterm-256color`. Stripping `TMUX` is required — if the dev server is started
from inside a tmux session, the child inherits it and nested tmux refuses to launch
with "sessions should be nested with care."

If `tmux` is not on `PATH`, the server sends `{"type":"error"}` with a readable
message rather than letting the pane die on an opaque `ENOENT`.

### Lifecycle

| Event | Result |
|---|---|
| Socket closes (reload, tab close) | PTY killed → tmux client detaches → **session survives** |
| tmux client exits (`exit`, detach) | PTY exits → socket closes → pane shows `[session ended]` + Restart |
| Restart clicked | New socket, new `hello`; `-A` reattaches or recreates |
| Server restarts | All four sessions still present; reattach on next load |

## Modules

Ordered so each is testable without the ones below it.

### Server

| Module | Purpose | Depends on |
|---|---|---|
| `shared/protocol.ts` | Control-message types, parse, serialize. Shared with the client. | — (pure) |
| `server/tmux.ts` | Build argv and env for a pane id; detect tmux on `PATH`. | — (pure) |
| `server/auth.ts` | Origin allowlist; constant-time token compare. | — (pure) |
| `server/token.ts` | Generate and hold the per-process boot token. | `node:crypto` |
| `server/pty-session.ts` | Own one PTY ↔ one socket for its lifetime. | the above |
| `server.ts` | HTTP server, Next handler, upgrade routing. Wiring only. | `pty-session` |

### Client

| Module | Purpose |
|---|---|
| `app/page.tsx` | Server Component; reads boot token, renders the grid |
| `components/terminal-grid.tsx` | Owns `colSplit` / `rowSplit`; localStorage persistence |
| `components/terminal-pane.tsx` | Owns one core, one socket, one `<Terminal>`, status overlay |
| `components/split-divider.tsx` | Pointer drag, keyboard, ARIA |
| `lib/split-layout.ts` | Pure: clamp, drag delta, grid template strings |
| `lib/use-pty-socket.ts` | Hook: connect → `hello` → binary I/O, throttled resize, status |

All drag arithmetic lives in `split-layout.ts` so it is unit-testable without a DOM.

### Layout

A single CSS grid, avoiding nested-flex measurement:

```
gridTemplateColumns: `${colSplit}% 6px 1fr`
gridTemplateRows:    `${rowSplit}% 6px 1fr`
```

Dividers are grid cells spanning their full track, producing the cross shape. Splits
clamp to 10–90% and persist to `localStorage`.

`SplitDivider` is keyboard accessible: `role="separator"`, `aria-orientation`,
`aria-valuenow`, `tabIndex=0`, arrow keys ±1%, shift+arrow ±5%, `Home`/`End`.

### Pane states

`loading-core` → `connecting` → `ready`, plus `ended` (with Restart) and `error`
(tmux missing, auth rejected).

## Implementation details worth stating

**One `GhosttyCore` per pane.** `GhosttyCore` is stateful — it holds `termPtr`,
dimensions, and scrollback. Sharing one instance across four panes would render four
copies of the same terminal. Note that the `@wterm/ghostty` README's own React example
shows a module-level `const core = await GhosttyCore.load()`; that is correct only for
a single terminal. The `.wasm` is fetched once and reused from HTTP cache; only the
instance is per-pane.

**`app/page.tsx` must be `dynamic = "force-dynamic"`.** It renders the boot token. A
statically prerendered page would embed the token from whenever `next build` ran, and
every socket would fail auth under `next start`.

**Resize is throttled.** Dragging a divider fires `ResizeObserver` at frame rate;
unthrottled that is four tmux resizes per frame, and tmux redraws the full screen on
each. Trailing 50ms throttle per pane.

**`<Terminal core={...}>` ignores `wasmUrl`.** Only `ghostty-vt.wasm` is needed;
`wterm.wasm` (the built-in Zig core) is not used and is not vendored.

## Toolchain

- Next.js 16, React 19, TypeScript strict, **npm**.
- Plain **CSS Modules** — four panes and two dividers do not justify Tailwind.
- Dev server at plain `http://127.0.0.1:3000` (override with `PORT`); no portless.
- `next.config`:
  `transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react", "@wterm/ghostty"]`,
  `serverExternalPackages: ["node-pty"]`. The upstream example omits `@wterm/ghostty`
  from that list; we include it because we load the ghostty core on every pane and
  transpiling a package that does not need it is harmless.
- Dependencies pinned to published `0.3.2` for `@wterm/core`, `@wterm/dom`,
  `@wterm/react`, `@wterm/ghostty`. The upstream example uses `workspace:*`, which
  does not resolve outside that monorepo.
- `node-pty` ^1.1.0. On macOS its prebuilt `spawn-helper` needs `chmod +x`; the
  example does this in a `predev`/`prebuild` hook and we do the same.
- `public/ghostty-vt.wasm` is **committed to git**, not copied at build time.

**Committed-wasm drift guard.** A vendored binary can silently diverge from whatever
`@wterm/ghostty` version `package-lock.json` resolves to, and a mismatched VT core
fails in confusing ways. A unit test byte-compares `public/ghostty-vt.wasm` against
`node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm`, so an `npm update` that moves the
binary fails the test run instead of producing a subtly broken terminal.

## Testing

### Vitest, pure

- `split-layout` — clamping at both ends, drag deltas, template output.
- `protocol` — round-trip encode/parse; malformed and hostile input rejected.
- `tmux` — argv is exactly `new-session -A -D -s termsite-N`; `TMUX` and `TMUX_PANE`
  stripped; `TERM` pinned.
- `auth` — allowed vs. denied origins; wrong-length and wrong-value tokens.
- `wasm-parity` — `public/ghostty-vt.wasm` byte-matches the installed package.

### Vitest + jsdom

`@wterm/react` and `WebSocket` are mocked.

- Pane sends a well-formed `hello` on open, forwards keystrokes, renders `ended` on
  socket close, renders the message on `error`.
- Grid: divider drag and arrow keys move the split; layout restores from
  `localStorage`.

### Playwright, one spec

Where the real confidence is — WASM plus PTY cannot be meaningfully unit tested.

- All four panes reach `ready`.
- `echo hi` typed in pane 2 appears in pane 2 and in no other pane.
- Dragging the divider reflows all four panes.
- **Reload preserves the session** — write a marker, reload, assert it is still on
  screen. This is the entire justification for the tmux decision and no unit test can
  demonstrate it.

Skipped with a clear message if `tmux` is not on `PATH`.

## Definition of done

Per `INIT.md`, not done until all four pass:

```
npm run lint
npm run type-check
npm test
npm run build
```

No commits and no pushes without explicit approval.

## Open risks

- **tmux is a hard runtime dependency.** Handled with a readable error, but there is
  no fallback to a bare shell. That is intentional: a silent fallback would drop
  persistence without saying so.
- **`node-pty` is a native module.** It needs prebuilds matching the local Node ABI
  (Node 22.22.2 here), and `next build` must not attempt to bundle it — hence
  `serverExternalPackages`.
- **Four WASM instances** cost roughly four times the core's memory. Expected to be
  fine for four panes; not validated beyond that.
