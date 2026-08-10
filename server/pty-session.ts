import { parseClientMessage, serializeMessage, type ErrorCode } from "@/shared/protocol";
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
  // Raw bytes, not a decoded string: the pty is opened with `encoding: null`,
  // because node-pty's 'utf8' default replaces every invalid byte with U+FFFD
  // before we ever see it and re-encoding cannot recover the original. This
  // module therefore forwards whatever it is handed, unmodified. Note that a
  // pane is still lossy for non-UTF-8 output end to end — tmux re-encodes it
  // upstream of here (see the spec's Transport section).
  onData(cb: (data: Buffer) => void): void;
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
  let tornDown = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      socket.close();
    }
  }, helloTimeoutMs);

  function fail(message: string, code?: ErrorCode): void {
    settled = true;
    clearTimeout(timer);
    socket.send(serializeMessage({ type: "error", message, code }));
    socket.close();
  }

  function start(pane: number, cols: number, rows: number): void {
    if (tmuxPath === null) {
      fail("tmux not found on PATH — install tmux to use terminal-site");
      return;
    }

    settled = true;
    clearTimeout(timer);

    // node-pty throws synchronously at fork time (EAGAIN/EMFILE under process
    // pressure, "posix_spawnp failed", a native ABI mismatch). Unguarded, that
    // throw escapes this socket's message handler; `settled` is already true
    // and the hello watchdog already cleared, so nothing else would ever tell
    // the pane what happened and it would sit at "connecting" forever.
    let handle: PtyHandle;
    try {
      handle = spawn({
        file: tmuxPath,
        args: tmuxArgs(pane),
        cols,
        rows,
        cwd,
        env,
      });
    } catch (error: unknown) {
      fail(`failed to start shell: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    handle.onData((data) => {
      if (tornDown) return;
      socket.send(data);
    });

    handle.onExit(() => {
      // The process is already gone — drop the handle so teardown does not
      // kill a dead pid, which can throw ESRCH inside the close handler.
      pty = null;
      tornDown = true;
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
      if (settled) return;
      if (!isTokenValid(msg.token, expectedToken)) {
        fail("unauthorized", "unauthorized");
        return;
      }
      start(msg.pane, msg.cols, msg.rows);
      return;
    }

    if (pty !== null) pty.resize(msg.cols, msg.rows);
  });

  socket.onClose(() => {
    clearTimeout(timer);
    tornDown = true;
    const handle = pty;
    pty = null;
    // Killing the PTY detaches the tmux client. The session survives.
    if (handle !== null) handle.kill();
  });
}
