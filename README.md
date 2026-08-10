# terminal-site

Four resizable terminals in the browser, in a 2×2 grid. Each pane is a live shell
on this machine, rendered with [wterm](https://github.com/vercel-labs/wterm) using
the [libghostty](https://ghostty.org) VT core and backed by its own tmux session.

## Security

**This serves a shell with your full environment. Run it on localhost only, and
only on a machine you are the sole user of.**

The server binds `127.0.0.1` and will not accept a WebSocket upgrade unless the
`Origin` header matches the loopback address it is serving, and the connection
presents a token generated fresh each time the server starts. Do not put this
behind a tunnel or a reverse proxy.

Those two layers stop a web page you happen to visit from reaching your shell
(cross-site WebSocket hijacking, DNS rebinding) and stop a page left open across a
server restart from silently reattaching. They do **not** make the token a secret
from the local machine: it is served in the page body to anything that can make an
HTTP request to the port. Any process — or any other user — on this machine can read
the page, forge the `Origin` header, and obtain a shell as you. Loopback is not
scoped per user, so **do not run this on a shared machine.**

## Requirements

- Node.js 22+
- tmux on `PATH`

## Usage

```bash
npm install
npm run dev
```

Or run the production build:

```bash
npm install
npm run build
npm start        # requires a prior `npm run build`
```

Both serve on http://127.0.0.1:3000 (override with `PORT`). `npm start` runs the same
`server.ts` with `NODE_ENV=production`; it does not build, so a stale or missing
`.next/` will make it fail or serve old output.

Each pane attaches to a tmux session named `termsite-0` … `termsite-3`, created on
first use. Because the state lives in tmux, the shells survive page reloads, server
restarts, and closing the browser. Attaching detaches any other client on that
session, so the browser pane always controls sizing. One caveat: if a pane is closed
within roughly a second of *first* connecting, the session it just created may not
survive — tmux has not finished establishing it yet. This applies to brand-new, empty
sessions only; a session you have actually used is unaffected.

After a server restart, pages left open in the browser hold the previous process's
token and cannot reconnect. Each pane says so and offers **Reload**; reloading picks
up the new token and reattaches to the same tmux sessions.

Drag the cross-shaped divider to resize. The dividers are keyboard operable: tab to
one, then use the arrow keys (hold shift for larger steps, `Home`/`End` for the
limits). The layout persists in `localStorage`.

To wipe a session and start fresh:

```bash
tmux kill-session -t termsite-0
```

## Development

```bash
npm run lint
npm run type-check
npm test          # Vitest
npm run test:e2e  # Playwright, requires tmux
npm run build
```

`public/ghostty-vt.wasm` is vendored from `@wterm/ghostty` and committed. A unit
test byte-compares it against the installed package, so bumping the dependency
without re-copying the binary fails the test run.
