# terminal-site

Four resizable terminals in the browser, in a 2×2 grid. Each pane is a live shell
on this machine, rendered with [wterm](https://github.com/vercel-labs/wterm) using
the [libghostty](https://ghostty.org) VT core and backed by its own tmux session.

## Security

**This serves a shell with your full environment. Run it on localhost only.**

The server binds `127.0.0.1` and will not accept a WebSocket upgrade unless the
`Origin` header matches the loopback address it is serving, and the connection
presents a token generated fresh each time the server starts. Do not put this
behind a tunnel or a reverse proxy.

## Requirements

- Node.js 22+
- tmux on `PATH`

## Usage

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000.

Each pane attaches to a tmux session named `termsite-0` … `termsite-3`, created on
first use. Because the state lives in tmux, the shells survive page reloads, server
restarts, and closing the browser. Attaching detaches any other client on that
session, so the browser pane always controls sizing.

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
