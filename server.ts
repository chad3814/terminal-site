import { createServer } from "node:http";
import { homedir } from "node:os";
import { parse } from "node:url";
import next from "next";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { allowedOrigins, isOriginAllowed } from "./server/auth";
import { attachPtySession, type PtyHandle, type SessionSocket } from "./server/pty-session";
import { findTmux, tmuxEnv } from "./server/tmux";
import { bootToken } from "./server/token";

const dev = process.env.NODE_ENV !== "production";
const hostname = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function toPtyHandle(term: pty.IPty): PtyHandle {
  return {
    onData(cb) {
      // node-pty's typings declare `onData` as `IEvent<string>` regardless of
      // the `encoding` option, but with `encoding: null` (set below) the
      // underlying stream is never given an encoding and emits Buffer. Accept
      // both so the difference is handled without an unchecked cast.
      term.onData((data: string | Buffer) => {
        cb(typeof data === "string" ? Buffer.from(data, "utf8") : data);
      });
    },
    onExit(cb) {
      term.onExit(() => cb());
    },
    write(data) {
      term.write(data);
    },
    resize(cols, rows) {
      term.resize(cols, rows);
    },
    kill() {
      term.kill();
    },
  };
}

function toSessionSocket(ws: WebSocket): SessionSocket {
  return {
    send(data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close() {
      ws.close();
    },
    onMessage(handler) {
      ws.on("message", (data: RawData, isBinary: boolean) => {
        handler(toBuffer(data), isBinary);
      });
    },
    onClose(handler) {
      ws.on("close", handler);
    },
  };
}

async function main(): Promise<void> {
  await app.prepare();

  // Resolved once at boot, so installing tmux while this process is running
  // changes nothing — hence the explicit restart instruction.
  const tmuxPath = await findTmux(process.env.PATH);
  if (tmuxPath === null) {
    console.warn(
      "tmux not found on PATH — every pane will report an error. Install tmux, then restart this server.",
    );
  }

  const origins = allowedOrigins(port);
  const env = tmuxEnv(process.env);
  const cwd = process.env.HOME ?? homedir();
  const token = bootToken();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url ?? "/", true));
  });

  // maxPayload caps an inbound WebSocket frame at 1 MiB, which is generous
  // for terminal input/paste but replaces ws's 100 MiB default so a hostile
  // local client cannot send an oversized frame (e.g. a bogus token or paste).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  // `WebSocketServer` is an EventEmitter: an 'error' it emits with no listener
  // is rethrown and takes the process — and its four PTYs — down.
  wss.on("error", (error: Error) => {
    console.error("terminal websocket server error:", error);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/", true);

    if (pathname !== "/api/terminal") {
      app.getUpgradeHandler()(req, socket, head);
      return;
    }

    if (!isOriginAllowed(req.headers.origin, origins)) {
      // Node's 'upgrade' contract hands over the raw socket, errors included.
      // A peer that resets the connection mid-rejection would otherwise emit
      // an unhandled 'error' and throw out of the event loop.
      socket.on("error", () => {});
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // `ws` emits 'error' on the WebSocket itself for receiver faults —
      // notably a `maxPayload` violation, which an ordinary >1 MiB paste
      // reaches with no hostile intent. Without a listener the EventEmitter
      // rethrows and kills a process holding four PTYs.
      ws.on("error", (error: Error) => {
        console.error("terminal socket error:", error);
        ws.close();
      });

      attachPtySession({
        socket: toSessionSocket(ws),
        expectedToken: token,
        tmuxPath,
        spawn: (args) =>
          toPtyHandle(
            pty.spawn(args.file, args.args, {
              name: "xterm-256color",
              cols: args.cols,
              rows: args.rows,
              cwd: args.cwd,
              env: args.env,
              // Hand back raw bytes. node-pty defaults to 'utf8', which
              // decodes pty output to a string and replaces any invalid byte
              // with U+FFFD before we ever see it, corrupting non-UTF-8
              // program output on its way to the browser.
              encoding: null,
            }),
          ),
        env,
        cwd,
      });
    });
  });

  // Closing each client fires the same "close" handler `attachPtySession`
  // already wires up per socket via `toSessionSocket`, which kills that
  // session's pty handle (SIGHUP to the local tmux client — detaches, does
  // not destroy the session; see server/pty-session.ts). Without this, a
  // signal that kills the process directly (e.g. Playwright tearing down
  // its webServer) never runs that handler, leaving an orphaned
  // `tmux new-session` client reparented to pid 1 for every open pane.
  const SHUTDOWN_DRAIN_MS = 1_000;
  let shuttingDown = false;

  function shutdown(signal: NodeJS.Signals): void {
    if (shuttingDown) return;
    shuttingDown = true;
    const clients = [...wss.clients];
    console.log(`> received ${signal}, closing ${clients.length} terminal socket(s)`);

    // Wait for each socket's own "close" event rather than a blind delay:
    // that event is what runs pty.kill() (SIGHUP to the tmux client), so
    // this exits as soon as every close handler has actually fired instead
    // of always paying the full drain time. The timeout is only a fallback
    // for a socket that never closes cleanly.
    const allClosed = Promise.all(
      clients.map(
        (client) =>
          new Promise<void>((resolve) => {
            if (client.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }
            client.once("close", () => resolve());
            client.close();
          }),
      ),
    );
    const drainTimeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_MS));

    Promise.race([allClosed, drainTimeout]).then(() => process.exit(0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, hostname, () => {
    console.log(`> terminal-site ready on http://${hostname}:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
