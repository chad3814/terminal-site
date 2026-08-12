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
- Theme switcher, `Cmd+1..4` focus shortcuts.
- ~~Per-pane header chrome~~ — reversed. Each pane now carries a header showing
  a live title and a health dot; see "Pane headers" below.
- Scrollback UI beyond what wterm and tmux copy-mode already provide.

## Threat model

The server spawns a login shell with the full user environment. Anyone who can reach
the port owns the machine — or, in a container, the container.

There are two supported deployments, and they have different boundaries.

**A. Direct on a workstation (the original).** Binds `127.0.0.1`, single-user,
localhost-only. Everything in "What is defended" and "What is *not* defended" below
describes this mode.

**B. Containerised, behind an authenticated reverse proxy.** The shells are the
*container's*, not the host's, so a compromise costs the container rather than the
machine. Reachability is the container network, not loopback, so two things replace
the loopback bind:

- **No published port.** `docker-compose.yaml` uses `expose`, never `ports`. This is
  the load-bearing line: publishing would put a shell on the host's interfaces.
- **A trusted-peer check.** Every WebSocket upgrade is rejected unless the TCP peer
  is inside `TRUSTED_PROXIES`. See "Running behind a proxy" below.

`HOST` defaults to `127.0.0.1`, so mode A is what you get unless it is deliberately
overridden.

### What is defended

1. **Bind + Origin allowlist.** The server listens on `127.0.0.1` only. WebSocket
   upgrades are rejected unless `Origin` is `http://127.0.0.1:<port>` or
   `http://localhost:<port>`. Both loopback spellings are hardcoded; only the *port*
   is substituted (`server/auth.ts` takes the port and nothing else), so setting
   `PORT` cannot silently lock the app out of its own socket. Browsers always send
   `Origin` on WebSocket upgrades, so this stops a page you happen to visit from
   opening a socket to your shell (cross-site WebSocket hijacking).
2. **Boot token.** 32 random bytes generated once per server process, embedded in the
   page by a Server Component and echoed back in the handshake.

Between them these cover:

- **Cross-site WebSocket hijacking** — the `Origin` check rejects it, and a
  cross-origin page cannot read our HTML to obtain the token either.
- **DNS rebinding** — an attacker who rebinds a hostname they control to `127.0.0.1`
  sends *their own* origin, which fails the allowlist; and even if the origin check
  were bypassed, the same-origin policy still prevents them reading the token out of
  our page.
- **Stale or reloaded pages** — the token is per-process, so a page left open across
  a server restart is rejected rather than silently reattaching.

### What is *not* defended

**The token is not a secret from the local machine.** It is served in the page body
to anyone who can make an HTTP request to the port. A non-browser client can fetch
`/`, scrape the token, set the `Origin` header to `http://127.0.0.1:<port>` by hand,
and obtain a live shell. This has been verified, not assumed.

Neither layer protects against that, and neither is intended to:

- Any process running as you can already run anything as you, so on a single-user
  machine this grants nothing new.
- **On a multi-user machine it is a privilege escalation.** Loopback is not
  uid-scoped: any *other* local user can read the page and get a shell as you.

There is no defence against this in the design. Any process — or any other user — on
this machine can read the page and obtain a shell as you, **so do not run this on a
shared machine.**

The README must state plainly that this exposes a shell, is localhost-only, and is
unsafe on a multi-user machine.

### Running behind a proxy

`X-Forwarded-For` authorises nothing. It is client-supplied, and nginx *appends* to
it rather than replacing it, so a client can send `X-Forwarded-For: 10.0.0.1` and
have that value survive as the leftmost entry. Any check that trusted the left of
that header would be a bypass for anyone who can reach the port.

The only unspoofable signal is the TCP peer, `req.socket.remoteAddress` — the address
the kernel completed a handshake with. So the order is:

1. Reject the upgrade unless the **peer** is inside `TRUSTED_PROXIES` (`server/forwarded.ts`).
2. Reject unless `Origin` is in `ALLOWED_ORIGINS` — exact strings, no wildcards.
3. Reject unless the first frame carries the boot token.

Only after (1) is the forwarded chain walked, right-to-left past hops we trust, to
work out the real client address. That result is used **for logging only**.

Both trust lists throw at boot on a malformed entry rather than skipping it: a trust
list that silently ignores what it cannot read leaves the operator believing a proxy
is trusted when it is not.

Deliberate limits, stated because they bound what this actually buys:

- **The trusted network is as narrow as Docker allows, which is not very.** Container
  addresses are assigned dynamically, so `TRUSTED_PROXIES` has to name the subnet
  rather than one host. Every container on that network is therefore inside the trust
  boundary. Keep the network to the proxy and the services it fronts.
- **IPv4 only.** An address the parser cannot read is never trusted, so a genuine IPv6
  peer fails closed rather than being waved through.
- **The boot token does not keep a sibling container out.** `GET /` is not
  peer-checked, so anything that can reach the port can fetch the page and read the
  token out of the body — verified, not assumed. And peer-checking `GET /` would not
  help while the trusted set is the whole subnet, because a sibling's own address is
  inside it. The full chain for any container on the proxy network is: fetch `/`,
  scrape the token, open the socket (peer check passes), set `Origin` by hand (trivial
  off-browser), and get a shell. What the token actually defends against is a stale
  page after a restart, and a request from outside the trusted set. Closing this needs
  a static address for the proxy so `TRUSTED_PROXIES` can be a `/32`, not a doc change.

- **The shells can reach everything the proxy fronts, from inside the auth wall.**
  This is the direction that matters most and is easy to miss: the container joins the
  proxy network, so its shells can talk to every other service on it, on its internal
  port, bypassing the edge nginx and Authelia entirely. A foothold in a pane is a
  foothold behind the auth wall for every application on that network. Putting
  terminal-site on its own network, with the proxy attached to that, is the way to
  bound it.

- **A pane is root-equivalent inside the container.** The image runs as `node` so that
  files written to the `/work` bind mount are owned by uid 1000 rather than root, but
  it grants passwordless sudo so the box is usable for development. Running as a
  non-root user is a host-file-ownership convenience here, not a security boundary.

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

The PTY is opened with `encoding: null` so this layer is honest about it. node-pty
defaults to `encoding: 'utf8'`, which decodes PTY output to a string and substitutes
U+FFFD for every invalid byte *before* the server sees it; re-encoding that string
cannot recover the original. With `encoding: null` node-pty hands back `Buffer` and
`server/pty-session.ts` forwards it unmodified.

Inbound frames still transit a UTF-8 string, which is lossless in practice because the
browser only ever sends `TextEncoder` output.

**Known deviation: "raw PTY bytes" is not true end-to-end, and cannot be.** Measured,
not assumed — the same `printf '<\x80\xfe\xff>'` through a bare shell and through
tmux, both on a `encoding: null` PTY:

| Path | Invalid bytes preserved | U+FFFD introduced |
|---|---|---|
| node-pty → bare shell | yes | no |
| node-pty → **tmux** → shell | **no** | **yes** |

tmux is a terminal emulator, not a pipe: it parses program output into a cell grid and
re-encodes for the attached client, and invalid UTF-8 does not survive that. The
substitution happens inside tmux, upstream of anything this codebase controls. Fixing
it would mean giving up tmux, i.e. giving up persistence — the entire point of the
design. So non-UTF-8 program output *is* still lossy in a pane; `encoding: null`
removes the one lossy hop we own, and is a prerequisite for any future raw
(non-persistent) pane mode. Multibyte UTF-8 round-trips intact, verified end-to-end.

Inbound frames are capped at 1 MiB (`maxPayload`), well above any realistic paste and
far below `ws`'s 100 MiB default.

### Pane headers

Each pane carries a thin header: a health dot plus a live title of the form
`command · directory` (e.g. `vim · terminal-site`). It costs one row of
terminal height per pane.

The pane's accessible name stays `Terminal N` and does **not** follow the
title. The title changes with every `cd` and every command, and both the grid
and the Playwright suite address panes by that name; an identity that moves is
not addressable. The title is rendered as visible text instead, and the dot is
an `img` with an accessible name so its meaning is not carried by colour alone.
The header sits outside the overlay's stacking context, so a dead pane still
shows what it was.

#### Where the title comes from

Not from the terminal core. `@wterm/ghostty` implements `getTitle()` as
`return null` unconditionally — "a full stream handler would be needed for
title support" — so `<Terminal onTitle>` can never fire while that core is in
use. The built-in Zig core does implement it, but switching cores would give up
the VT compliance the ghostty dependency exists for.

Instead `lib/osc-title.ts` scans the PTY byte stream for OSC 0/1/2 sequences as
it arrives in `usePtySocket`, before the bytes are handed to the terminal. It
is a pure incremental state machine, so a sequence split across frames is still
recognised, and it only observes — every byte still reaches the core unchanged.

#### Why tmux needs three options

`tmuxArgs` sets three *session* options, scoped with `-t` so the user's global
tmux configuration and their own sessions are untouched:

| Option | Why |
|---|---|
| `set-titles on` | Off by default. While off tmux never emits the OSC sequence at all, and the header stays empty forever. |
| `set-titles-string` | The format above. |
| `status-interval 1` | tmux re-evaluates and emits the title on its **periodic status redraw**, not when the foreground command changes. |

The last one is the subtle one and was found empirically. At the inherited
interval (15s by default, 5s on the development machine) any command shorter
than the interval starts and finishes between ticks, so its title is never
emitted and the header silently misses most of what you run — a 3s `sleep`
produced no title at all on either a fresh or a reattached session. At 1s it
produced one every time. The cost is a status-line diff per second per pane,
measured at roughly 35 bytes/sec.

This also means titles are **eventually consistent, not instantaneous**: the
header lags the shell by up to one status interval.

### Control messages

```jsonc
// client → server, required first frame
{ "type": "hello",  "token": "…", "pane": 0, "cols": 80, "rows": 24 }
{ "type": "resize", "cols": 100, "rows": 30 }

// server → client
{ "type": "ready" }
{ "type": "error", "message": "tmux not found on PATH" }
{ "type": "error", "message": "unauthorized", "code": "unauthorized" }
```

`error.code` is optional and machine-readable; `message` is human-readable and
unstable. The client branches on `code`, never on prose. Parsing stays strict: an
unrecognised `code` is rejected outright rather than degraded to a codeless error.

The only code so far is `unauthorized`. Because the boot token is per-process and
baked into the page HTML, a rejected token means the server has restarted since the
page rendered — reconnecting can only replay the same dead token. The pane therefore
offers **Reload**, not Restart, for that code. Without it, a server restart leaves
every pane in a loop: `ended` → Restart → `unauthorized` → Restart → …

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
| Server restarts | All four sessions still present. Open pages hold a dead token, so their panes show `error` with `code: "unauthorized"` and offer **Reload**; the reloaded page gets the new token and reattaches |

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
(tmux missing, spawn failed, auth rejected).

Every non-`ready` state renders an overlay, including `connecting` — otherwise a pane
whose handshake never completes looks exactly like a working one that has produced no
output yet. Exactly one overlay is chosen, most-fatal first (core failure → socket
error → ended → core loading → connecting), so two `inset: 0` panels can never stack.
An overlay with no button sets `pointer-events: none` so it cannot swallow clicks
meant for the terminal underneath.

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

**Every WebSocket needs an `'error'` listener.** `ws` emits `'error'` on the
`WebSocket` object for receiver faults, and a `maxPayload` violation is one — reachable
by pasting more than 1 MiB into a pane, no attacker required. An `EventEmitter`
`'error'` with no listener throws, and the throw would only be absorbed by the global
`uncaughtException` handler Next happens to install, leaving a process that owns four
PTYs in an explicitly undefined state. Listeners are therefore attached to the `ws`
instance, to the raw upgrade socket on the 403 reject path (Node's `'upgrade'`
contract hands over that socket, errors included), and to the `WebSocketServer`.

**`spawn()` can throw.** node-pty throws synchronously at fork time on EAGAIN/EMFILE,
`posix_spawnp failed`, or a native ABI mismatch. That throw happens inside the socket's
message handler, after the hello watchdog has been cleared — so unguarded it produces
a pane stuck at `connecting` with nothing on the wire. The spawn is wrapped and routed
through the same `error` frame path as a missing tmux.

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

- All four panes reach `ready`. Asserted via `role="textbox"`, which only exists once
  that pane's core has mounted. Asserting on the pane element itself proves nothing:
  `role="group"` renders unconditionally, before the core loads and before any socket
  exists, so a negative isolation assertion against it would pass for a pane that
  never connected at all.
- A distinct marker is echoed in *every* pane and each is asserted present in its own
  pane and absent from all others — isolation checked in both directions, not just
  from one pane outward.
- Dragging the divider reflows all four panes.
- **Reload preserves the session** — write a marker, reload, assert it is still on
  screen. This is the entire justification for the tmux decision and no unit test can
  demonstrate it.

Skipped with a clear message if `tmux` is not on `PATH`.

## Definition of done

Per `INIT.md`, not done until all of these pass:

```
npm run lint
npm run type-check
npm test
npm run build
npm run test:e2e   # requires tmux
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
