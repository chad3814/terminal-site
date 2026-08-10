import { createServer } from "node:http";
import { homedir } from "node:os";
import { parse } from "node:url";
import next from "next";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { allowedOrigins, isOriginAllowed } from "./server/auth";
import { attachPtySession, type SessionSocket } from "./server/pty-session";
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

  const tmuxPath = await findTmux(process.env.PATH);
  if (tmuxPath === null) {
    console.warn("tmux not found on PATH — panes will report an error until it is installed");
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

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/", true);

    if (pathname !== "/api/terminal") {
      app.getUpgradeHandler()(req, socket, head);
      return;
    }

    if (!isOriginAllowed(req.headers.origin, origins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      attachPtySession({
        socket: toSessionSocket(ws),
        expectedToken: token,
        tmuxPath,
        spawn: (args) =>
          pty.spawn(args.file, args.args, {
            name: "xterm-256color",
            cols: args.cols,
            rows: args.rows,
            cwd: args.cwd,
            env: args.env,
          }),
        env,
        cwd,
      });
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> terminal-site ready on http://${hostname}:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
