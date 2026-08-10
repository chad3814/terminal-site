import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMessage } from "@/shared/protocol";
import {
  attachPtySession,
  type PtyHandle,
  type SessionSocket,
  type SpawnPty,
  type SpawnPtyArgs,
} from "./pty-session";

const TOKEN = "correct-token";

interface FakeSocket extends SessionSocket {
  sent: (string | Uint8Array)[];
  closed: boolean;
  emitText(text: string): void;
  emitBinary(bytes: Uint8Array): void;
  emitClose(): void;
}

function makeSocket(): FakeSocket {
  let onMessage: ((data: Buffer, isBinary: boolean) => void) | null = null;
  let onClose: (() => void) | null = null;
  return {
    sent: [],
    closed: false,
    send(data) {
      this.sent.push(data);
    },
    close() {
      // A real WebSocket fires its own "close" event whenever close() is
      // called, whether the call originated locally or remotely, and it
      // only fires once. Mirror that so the exit -> close -> kill feedback
      // loop this module creates is actually exercised by the fakes.
      if (this.closed) return;
      this.closed = true;
      onClose?.();
    },
    onMessage(handler) {
      onMessage = handler;
    },
    onClose(handler) {
      onClose = handler;
    },
    emitText(text) {
      onMessage?.(Buffer.from(text, "utf8"), false);
    },
    emitBinary(bytes) {
      onMessage?.(Buffer.from(bytes), true);
    },
    emitClose() {
      this.close();
    },
  };
}

interface FakePty extends PtyHandle {
  written: string[];
  resizes: [number, number][];
  killed: boolean;
  emitData(data: string): void;
  emitExit(): void;
}

function makePty(): FakePty {
  let onData: ((data: string) => void) | null = null;
  let onExit: (() => void) | null = null;
  return {
    written: [],
    resizes: [],
    killed: false,
    onData(cb) {
      onData = cb;
    },
    onExit(cb) {
      onExit = cb;
    },
    write(data) {
      this.written.push(data);
    },
    resize(cols, rows) {
      this.resizes.push([cols, rows]);
    },
    kill() {
      this.killed = true;
    },
    emitData(data) {
      onData?.(data);
    },
    emitExit() {
      onExit?.();
    },
  };
}

function textFrames(socket: FakeSocket): string[] {
  return socket.sent.filter((frame): frame is string => typeof frame === "string");
}

let socket: FakeSocket;
let pty: FakePty;
let spawnArgs: SpawnPtyArgs[];
let spawn: SpawnPty;

beforeEach(() => {
  socket = makeSocket();
  pty = makePty();
  spawnArgs = [];
  spawn = (args) => {
    spawnArgs.push(args);
    return pty;
  };
});

function attach(overrides: Partial<Parameters<typeof attachPtySession>[0]> = {}): void {
  attachPtySession({
    socket,
    expectedToken: TOKEN,
    tmuxPath: "/usr/bin/tmux",
    spawn,
    env: { HOME: "/home/test" },
    cwd: "/home/test",
    ...overrides,
  });
}

function hello(token = TOKEN, pane = 1): string {
  return serializeMessage({ type: "hello", token, pane, cols: 80, rows: 24 });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("attachPtySession", () => {
  it("spawns tmux with attach-or-create args on a valid hello", () => {
    attach();
    socket.emitText(hello());

    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]?.file).toBe("/usr/bin/tmux");
    expect(spawnArgs[0]?.args).toEqual([
      "new-session",
      "-A",
      "-D",
      "-s",
      "termsite-1",
    ]);
    expect(spawnArgs[0]?.cols).toBe(80);
    expect(spawnArgs[0]?.rows).toBe(24);
    expect(textFrames(socket)).toContain(serializeMessage({ type: "ready" }));
  });

  it("refuses a bad token without spawning anything", () => {
    attach();
    socket.emitText(hello("wrong-token"));

    expect(spawnArgs).toHaveLength(0);
    expect(socket.closed).toBe(true);
    expect(textFrames(socket)[0]).toContain("unauthorized");
  });

  it("reports a readable error when tmux is missing", () => {
    attach({ tmuxPath: null });
    socket.emitText(hello());

    expect(spawnArgs).toHaveLength(0);
    expect(textFrames(socket)[0]).toContain("tmux not found on PATH");
    expect(socket.closed).toBe(true);
  });

  it("closes the socket when no hello arrives in time", () => {
    vi.useFakeTimers();
    attach({ helloTimeoutMs: 5000 });
    vi.advanceTimersByTime(5001);
    expect(socket.closed).toBe(true);
    expect(spawnArgs).toHaveLength(0);
  });

  it("ignores input and resize before a hello", () => {
    attach();
    socket.emitBinary(new TextEncoder().encode("ls\n"));
    socket.emitText(serializeMessage({ type: "resize", cols: 10, rows: 10 }));
    expect(pty.written).toEqual([]);
    expect(pty.resizes).toEqual([]);
  });

  it("forwards binary input to the pty and pty output back as binary", () => {
    attach();
    socket.emitText(hello());
    socket.emitBinary(new TextEncoder().encode("echo hi\n"));
    expect(pty.written).toEqual(["echo hi\n"]);

    pty.emitData("hi\r\n");
    const binary = socket.sent.filter((f): f is Uint8Array => typeof f !== "string");
    expect(binary).toHaveLength(1);
    expect(new TextDecoder().decode(binary[0])).toBe("hi\r\n");
  });

  it("forwards resize after hello", () => {
    attach();
    socket.emitText(hello());
    socket.emitText(serializeMessage({ type: "resize", cols: 120, rows: 40 }));
    expect(pty.resizes).toEqual([[120, 40]]);
  });

  it("ignores malformed control frames instead of crashing", () => {
    attach();
    socket.emitText(hello());
    socket.emitText("{not json");
    socket.emitText('{"type":"resize","cols":-5,"rows":10}');
    expect(pty.resizes).toEqual([]);
  });

  it("kills the pty when the socket closes, leaving the tmux session alive", () => {
    attach();
    socket.emitText(hello());
    socket.emitClose();
    expect(pty.killed).toBe(true);
  });

  it("closes the socket when the pty exits", () => {
    attach();
    socket.emitText(hello());
    pty.emitExit();
    expect(socket.closed).toBe(true);
  });

  it("does not kill an already-exited pty when the exit triggers socket close", () => {
    attach();
    socket.emitText(hello());
    pty.emitExit();
    expect(socket.closed).toBe(true);
    expect(pty.killed).toBe(false);
  });

  it("does not send pty output that arrives after teardown", () => {
    attach();
    socket.emitText(hello());
    const framesBeforeExit = socket.sent.length;
    pty.emitExit();
    pty.emitData("late output");
    expect(socket.sent.length).toBe(framesBeforeExit);
  });

  it("ignores a second hello", () => {
    attach();
    socket.emitText(hello());
    socket.emitText(hello());
    expect(spawnArgs).toHaveLength(1);
  });
});
