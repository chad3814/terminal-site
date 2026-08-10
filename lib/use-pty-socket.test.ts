import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMessage } from "@/shared/protocol";
import { MockWebSocket } from "@/test/mock-websocket";
import { usePtySocket } from "./use-pty-socket";

beforeEach(() => {
  MockWebSocket.reset();
  MockWebSocket.install();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup(write = vi.fn()) {
  const result = renderHook(() => usePtySocket({ pane: 2, token: "tok", write }));
  return { ...result, write };
}

describe("usePtySocket", () => {
  it("starts in the connecting state and opens no socket until connect", () => {
    const { result } = setup();
    expect(result.current.status).toBe("connecting");
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("sends a well-formed hello on open", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());

    expect(MockWebSocket.textFrames(MockWebSocket.last())).toEqual([
      serializeMessage({ type: "hello", token: "tok", pane: 2, cols: 80, rows: 24 }),
    ]);
  });

  it("becomes ready on the ready frame", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
    expect(result.current.status).toBe("ready");
  });

  it("surfaces a server error message", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(
        serializeMessage({ type: "error", message: "tmux not found on PATH" }),
      ),
    );
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("tmux not found on PATH");
    expect(result.current.errorCode).toBeNull();
  });

  it("surfaces the error code when the server sends one", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(
        serializeMessage({ type: "error", message: "unauthorized", code: "unauthorized" }),
      ),
    );
    expect(result.current.errorCode).toBe("unauthorized");

    act(() => result.current.restart());
    expect(result.current.errorCode).toBeNull();
  });

  it("sends the size current at handshake time, not at connect time", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));

    // A divider drag (or a font/layout settle) between connect() and the
    // socket actually opening. `sendResize` cannot deliver this — the socket
    // is still CONNECTING — so the hello is the only chance to get it right.
    act(() => result.current.sendResize(120, 40));
    act(() => MockWebSocket.last().open());

    expect(MockWebSocket.textFrames(MockWebSocket.last())[0]).toBe(
      serializeMessage({ type: "hello", token: "tok", pane: 2, cols: 120, rows: 40 }),
    );
  });

  it("writes binary frames into the terminal", () => {
    const write = vi.fn();
    const { result } = setup(write);
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(new TextEncoder().encode("hi").buffer));

    expect(write).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(write.mock.calls[0]?.[0])).toBe("hi");
  });

  it("sends input as binary once the session is ready", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
    act(() => result.current.sendInput("ls\n"));

    // `instanceof Uint8Array` is unusable here: under this project's jsdom
    // test environment, TextEncoder's output is a Uint8Array from a
    // different realm than the global Uint8Array, so `instanceof` silently
    // returns false. ArrayBuffer.isView is realm-independent.
    const binary = MockWebSocket.last().sent.filter(
      (frame): frame is Uint8Array => ArrayBuffer.isView(frame),
    );
    expect(new TextDecoder().decode(binary[0])).toBe("ls\n");
  });

  it("buffers input sent before ready and flushes it in order once ready arrives", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());

    // The socket is open but the server has not yet spawned the pty — this
    // is exactly the window where a fire-and-forget send would be dropped
    // (see server/pty-session.ts `start()`, where `pty` is still null).
    act(() => {
      result.current.sendInput("ec");
      result.current.sendInput("ho hi\n");
    });

    const beforeReady = MockWebSocket.last().sent.filter(
      (frame): frame is Uint8Array => ArrayBuffer.isView(frame),
    );
    expect(beforeReady).toHaveLength(0);

    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));

    const binary = MockWebSocket.last().sent.filter(
      (frame): frame is Uint8Array => ArrayBuffer.isView(frame),
    );
    expect(binary.map((frame) => new TextDecoder().decode(frame))).toEqual(["ec", "ho hi\n"]);
  });

  it("discards queued input on restart instead of replaying it into the new session", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => result.current.sendInput("stale input"));

    act(() => result.current.restart());
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));

    const binary = MockWebSocket.last().sent.filter(
      (frame): frame is Uint8Array => ArrayBuffer.isView(frame),
    );
    expect(binary).toHaveLength(0);
  });

  it("throttles resize to one trailing frame", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());

    act(() => {
      result.current.sendResize(81, 24);
      result.current.sendResize(82, 24);
      result.current.sendResize(83, 25);
    });
    expect(MockWebSocket.textFrames(MockWebSocket.last())).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(60));
    const frames = MockWebSocket.textFrames(MockWebSocket.last());
    expect(frames.at(-1)).toBe(serializeMessage({ type: "resize", cols: 83, rows: 25 }));
    expect(frames).toHaveLength(2);
  });

  it("goes to ended when the socket closes", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().close());
    expect(result.current.status).toBe("ended");
  });

  it("reconnects with the last known size on restart", () => {
    const { result } = setup();
    act(() => result.current.connect(90, 30));
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().close());
    act(() => result.current.restart());
    act(() => MockWebSocket.last().open());

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.textFrames(MockWebSocket.last())).toEqual([
      serializeMessage({ type: "hello", token: "tok", pane: 2, cols: 90, rows: 30 }),
    ]);
  });

  it("closes the socket on unmount", () => {
    const { result, unmount } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    const socket = MockWebSocket.last();
    unmount();
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("ignores a stale close from a superseded socket", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    const stale = MockWebSocket.last();
    act(() => stale.open());

    act(() => result.current.connect(80, 24));
    const fresh = MockWebSocket.last();
    act(() => fresh.open());
    act(() => fresh.receive(serializeMessage({ type: "ready" })));
    expect(result.current.status).toBe("ready");

    // Simulate a late, out-of-order close event arriving from the socket
    // that `connect()` already superseded. Real browsers deliver close
    // events asynchronously, so this can arrive well after a new socket
    // is open; it must not be able to knock a live pane back to "ended".
    act(() => stale.onclose?.());

    expect(result.current.status).toBe("ready");
  });

  it("keeps the error status when the socket later closes", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(serializeMessage({ type: "error", message: "boom" })),
    );
    act(() => MockWebSocket.last().close());

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("boom");
  });

  it("clears the errored flag on restart", () => {
    const { result } = setup();
    act(() => result.current.connect(80, 24));
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(serializeMessage({ type: "error", message: "boom" })),
    );
    expect(result.current.status).toBe("error");

    act(() => result.current.restart());
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
    expect(result.current.status).toBe("ready");

    act(() => MockWebSocket.last().close());
    expect(result.current.status).toBe("ended");
  });
});
