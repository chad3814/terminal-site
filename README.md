# terminal-site

Four resizable terminals in the browser, in a 2×2 grid. Each pane is a live shell
on this machine, rendered with [wterm](https://github.com/vercel-labs/wterm) using
the [libghostty](https://ghostty.org) VT core and backed by its own tmux session.

## Security

**This serves a shell.** There are two supported ways to run it, with different
boundaries. Read the one you are using.

**Direct on a workstation (the default).** It serves a shell with *your* full
environment, so run it on localhost only, and only on a machine you are the sole
user of. `HOST` defaults to `127.0.0.1`, and a WebSocket upgrade is refused unless
the `Origin` matches the loopback address it is serving and the first frame carries
a token generated fresh each time the server starts. Do not put this mode behind a
tunnel or a reverse proxy — it has no notion of one, and the token is readable by
anything that can fetch the page.

**In a container, behind an authenticating reverse proxy.** The shells are the
*container's*, not your host's, and the upgrade is additionally gated on the TCP peer
being a trusted proxy. See [Running in Docker](#running-in-docker) — including what
it does *not* protect, which is more than you might expect.

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

## Running in Docker

The container is the machine: the four panes are shells **inside the container**, not
on your host. No dotfiles, no host tools, and the tmux sessions live and die with the
container. `zsh`, `tmux`, `git` and `build-essential` are in the image, so it is
usable as a dev box; the home directory is a named volume so anything you leave in
`~` survives a recreate.

```bash
cp .env.example .env      # then edit it — nothing has a safe default
docker compose up -d --build
```

Intended shape:

```
browser -> authenticating reverse proxy -> terminal-site container
```

### The one line that matters

`docker-compose.yaml` uses `expose`, never `ports`. The container serves a shell, and
the only thing keeping that off your network is that no host port is published:

```yaml
expose: ["3000"]      # reachable on the proxy network only
ports:  ["3000:3000"] # DO NOT — binds 0.0.0.0 on the host and publishes a shell
```

### Configuration

| Variable | Purpose |
|---|---|
| `HOST` | Bind address. Defaults to `127.0.0.1`; the container sets `0.0.0.0`, which is safe **only** because no port is published. |
| `TRUSTED_PROXIES` | Comma-separated CIDRs allowed to open a WebSocket, checked against the TCP peer. Defaults to loopback. A malformed entry stops the server at boot. |
| `ALLOWED_ORIGINS` | Comma-separated exact origins, e.g. `https://terminals.example.com`. Required behind a proxy: the browser sends the public origin, not the loopback one. No wildcards. |
| `VIRTUAL_HOST` / `VIRTUAL_PORT` | nginx-proxy discovery. `VIRTUAL_PORT` must equal `PORT`, or the Origin check rejects every socket. |
| `WORK_DIR` | Host directory bind-mounted at `/work`. Any shell in the container can write there. |

Find your proxy's subnet with:

```bash
docker network inspect <network> -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

### What this does and does not protect

`X-Forwarded-For` is client-supplied and authorises nothing — nginx appends to it, so
its leftmost entry can be attacker-chosen. Authorisation is the **TCP peer** against
`TRUSTED_PROXIES`; the forwarded chain is only walked afterwards, right-to-left, to
log the real client.

Because container addresses are dynamic, `TRUSTED_PROXIES` names a subnet, so **every
container on that network is inside the trust boundary**. Concretely, a sibling
container can fetch `/` (which is not peer-checked), read the boot token out of the
page, and open a socket — its own address passes the peer check. Put real
authentication in front of the proxy, and pin the proxy to a static address so
`TRUSTED_PROXIES` can be a `/32` if you want that closed.

**The outbound direction matters more.** The container joins the proxy network, so its
shells can reach every other service that network fronts, on its internal port,
bypassing the edge proxy and its auth entirely. A foothold in a pane is a foothold
behind the auth wall for every app on that network. Giving terminal-site its own
network and attaching the proxy to that is the way to bound it.

**A pane is root-equivalent in the container.** It runs as `node` so `/work` files are
owned by uid 1000 rather than root, but passwordless sudo is granted so the box is
usable for development. Drop the sudoers line in the Dockerfile if you would rather
not have that.

The image builds `node-pty` from source — it ships no Linux prebuilds — so build on
the architecture you will run on, or use `docker buildx` for the target platform.

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
