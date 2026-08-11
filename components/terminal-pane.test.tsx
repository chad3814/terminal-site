import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMessage } from "@/shared/protocol";
import { MockWebSocket } from "@/test/mock-websocket";

// `vi.mock` factories are hoisted above module scope, so a plain `const` declared
// here would not yet exist when the factory closes over it. `vi.hoisted` is the
// supported way to share a spy with a mock factory.
const { writeSpy, coreLoad } = vi.hoisted(() => ({ writeSpy: vi.fn(), coreLoad: vi.fn() }));

vi.mock("@wterm/ghostty", () => ({
  GhosttyCore: { load: coreLoad },
}));

vi.mock("@wterm/react/css", () => ({}));

vi.mock("@wterm/react", () => ({
  useTerminal: () => ({ ref: { current: null }, write: writeSpy }),
  Terminal: ({
    onReady,
    onData,
  }: {
    onReady?: (wt: { cols: number; rows: number }) => void;
    onData?: (data: string) => void;
  }) => {
    useEffect(() => {
      onReady?.({ cols: 100, rows: 40 });
    }, [onReady]);
    return (
      <button type="button" data-testid="fake-terminal" onClick={() => onData?.("x")}>
        terminal
      </button>
    );
  },
}));

const { TerminalPane } = await import("./terminal-pane");

beforeEach(() => {
  MockWebSocket.reset();
  MockWebSocket.install();
  writeSpy.mockClear();
  coreLoad.mockReset();
  coreLoad.mockResolvedValue({ kind: "fake-core" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPane() {
  render(<TerminalPane pane={1} token="tok" />);
  expect(await screen.findByTestId("fake-terminal")).toBeInTheDocument();

  // The socket is created by onReady, which fires from a passive effect that may
  // not have flushed when findByTestId resolves. Wait for it explicitly.
  await waitFor(() => {
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  });
}

/**
 * Deliver a title the way the real server does — as an OSC 0 sequence inside a
 * binary PTY frame — rather than by poking a callback. This exercises the
 * scanner and the hook alongside the component, which matters because the
 * terminal core never reports titles for us.
 */
function emitTitle(title: string): void {
  const bytes = new TextEncoder().encode(`\x1b]0;${title}\x07`);
  MockWebSocket.last().receive(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

describe("TerminalPane", () => {
  it("loads a core, then connects and sends hello with the terminal's size", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());

    expect(MockWebSocket.textFrames(MockWebSocket.last())).toEqual([
      serializeMessage({ type: "hello", token: "tok", pane: 1, cols: 100, rows: 40 }),
    ]);
  });

  it("shows a session-ended overlay with a restart control", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());
    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
    act(() => MockWebSocket.last().close());

    expect(await screen.findByText(/session ended/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /restart/i }));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("renders a server error message", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(
        serializeMessage({ type: "error", message: "tmux not found on PATH" }),
      ),
    );

    expect(await screen.findByText(/tmux not found on PATH/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /restart/i }));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("offers a reload, not a restart, when the token was rejected", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());
    act(() =>
      MockWebSocket.last().receive(
        serializeMessage({ type: "error", message: "unauthorized", code: "unauthorized" }),
      ),
    );

    expect(await screen.findByText(/server restarted — reload the page/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restart/i })).not.toBeInTheDocument();

    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    await userEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(reload).toHaveBeenCalledTimes(1);
    // The dead token must not be replayed over a fresh socket.
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("shows a connecting overlay until the session is ready", async () => {
    await renderPane();
    act(() => MockWebSocket.last().open());

    expect(await screen.findByText(/connecting/i)).toBeInTheDocument();

    act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
    await waitFor(() => {
      expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument();
    });
  });

  it("shows only one overlay when the core fails and the socket errors", async () => {
    coreLoad.mockRejectedValueOnce(new Error("wasm exploded"));
    render(<TerminalPane pane={0} token="tok" />);

    expect(await screen.findByText(/failed to load terminal core/i)).toBeInTheDocument();
    // The core never mounted, so no socket exists and no second overlay can
    // stack on top of this one.
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(screen.queryByText(/loading terminal core/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument();
  });

  it("labels the pane for assistive technology", async () => {
    await renderPane();
    expect(screen.getByRole("group", { name: /terminal 2/i })).toBeInTheDocument();
  });

  describe("header", () => {
    it("falls back to the pane label until a title arrives", async () => {
      await renderPane();
      expect(screen.getByText("Terminal 2")).toBeInTheDocument();
    });

    it("shows the title reported by the terminal, and follows later changes", async () => {
      await renderPane();

      act(() => emitTitle("zsh · cwalker"));
      expect(await screen.findByText("zsh · cwalker")).toBeInTheDocument();
      expect(screen.queryByText("Terminal 2")).not.toBeInTheDocument();

      act(() => emitTitle("vim · terminal-site"));
      expect(await screen.findByText("vim · terminal-site")).toBeInTheDocument();
      expect(screen.queryByText("zsh · cwalker")).not.toBeInTheDocument();
    });

    it("keeps the pane's accessible name fixed while the title changes", async () => {
      // The title churns with every cd and command. If it became the group's
      // accessible name, the grid and the Playwright suite could no longer
      // address a pane by identity.
      await renderPane();
      act(() => emitTitle("vim · terminal-site"));
      await screen.findByText("vim · terminal-site");

      expect(screen.getByRole("group", { name: "Terminal 2" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /vim/i })).not.toBeInTheDocument();
    });

    it("reports pane health as a named image, not colour alone", async () => {
      await renderPane();
      expect(screen.getByRole("img", { name: "connecting" })).toBeInTheDocument();

      act(() => MockWebSocket.last().open());
      act(() => MockWebSocket.last().receive(serializeMessage({ type: "ready" })));
      expect(await screen.findByRole("img", { name: "connected" })).toBeInTheDocument();

      act(() => MockWebSocket.last().close());
      expect(await screen.findByRole("img", { name: "session ended" })).toBeInTheDocument();
    });

    it("falls back to the pane label if the shell clears the title", async () => {
      await renderPane();
      act(() => emitTitle("vim · terminal-site"));
      await screen.findByText("vim · terminal-site");

      // Some programs clear the title with `ESC ] 0 ; BEL`. The scanner
      // faithfully reports "", which must not render as a blank header.
      act(() => emitTitle(""));
      expect(await screen.findByText("Terminal 2")).toBeInTheDocument();
    });

    // NOTE: jsdom does no layout, so this cannot verify that the header is
    // visually unobscured — only that both exist in the tree. That the header
    // sits outside the overlay's stacking context is asserted for real in the
    // Playwright suite.
    it("keeps the title in the tree alongside a session-ended overlay", async () => {
      await renderPane();
      act(() => emitTitle("vim · terminal-site"));
      await screen.findByText("vim · terminal-site");

      act(() => MockWebSocket.last().open());
      act(() => MockWebSocket.last().close());

      expect(await screen.findByText(/session ended/i)).toBeInTheDocument();
      expect(screen.getByText("vim · terminal-site")).toBeInTheDocument();
    });
  });
});
