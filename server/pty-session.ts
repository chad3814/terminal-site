import { parseClientMessage, serializeMessage } from "@/shared/protocol";
import { isTokenValid } from "./auth";
import { tmuxArgs } from "./tmux";

export const HELLO_TIMEOUT_MS = 5000;

export interface SessionSocket {
  send(data: string | Uint8Array): void;
  close(): void;
  onMessage(handler: (data: Buffer, isBinary: boolean) => void): void;
  onClose(handler: () => void): void;
}

export interface PtyHandle {
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface SpawnPtyArgs {
  file: string;
  args: string[];
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export type SpawnPty = (args: SpawnPtyArgs) => PtyHandle;

export interface PtySessionDeps {
  socket: SessionSocket;
  expectedToken: string;
  tmuxPath: string | null;
  spawn: SpawnPty;
  env: Record<string, string>;
  cwd: string;
  helloTimeoutMs?: number;
}

export function attachPtySession(deps: PtySessionDeps): void {
  const { socket, expectedToken, tmuxPath, spawn, env, cwd } = deps;
  const helloTimeoutMs = deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS;

  let pty: PtyHandle | null = null;
  let settled = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      socket.close();
    }
  }, helloTimeoutMs);

  function fail(message: string): void {
    settled = true;
    clearTimeout(timer);
    socket.send(serializeMessage({ type: "error", message }));
    socket.close();
  }

  function start(pane: number, cols: number, rows: number): void {
    if (tmuxPath === null) {
      fail("tmux not found on PATH — install tmux to use terminal-site");
      return;
    }

    settled = true;
    clearTimeout(timer);

    const handle = spawn({
      file: tmuxPath,
      args: tmuxArgs(pane),
      cols,
      rows,
      cwd,
      env,
    });

    handle.onData((data) => {
      socket.send(Buffer.from(data, "utf8"));
    });

    handle.onExit(() => {
      socket.close();
    });

    pty = handle;
    socket.send(serializeMessage({ type: "ready" }));
  }

  socket.onMessage((data, isBinary) => {
    if (isBinary) {
      if (pty !== null) pty.write(data.toString("utf8"));
      return;
    }

    const msg = parseClientMessage(data.toString("utf8"));
    if (msg === null) return;

    if (msg.type === "hello") {
      if (settled || pty !== null) return;
      if (!isTokenValid(msg.token, expectedToken)) {
        fail("unauthorized");
        return;
      }
      start(msg.pane, msg.cols, msg.rows);
      return;
    }

    if (pty !== null) pty.resize(msg.cols, msg.rows);
  });

  socket.onClose(() => {
    clearTimeout(timer);
    // Killing the PTY detaches the tmux client. The session survives.
    if (pty !== null) pty.kill();
  });
}
