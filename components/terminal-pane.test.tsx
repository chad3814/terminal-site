import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMessage } from "@/shared/protocol";
import { MockWebSocket } from "@/test/mock-websocket";

// `vi.mock` factories are hoisted above module scope, so a plain `const` declared
// here would not yet exist when the factory closes over it. `vi.hoisted` is the
// supported way to share a spy with a mock factory.
const { writeSpy } = vi.hoisted(() => ({ writeSpy: vi.fn() }));

vi.mock("@wterm/ghostty", () => ({
  GhosttyCore: { load: vi.fn(async () => ({ kind: "fake-core" })) },
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPane() {
  render(<TerminalPane pane={1} token="tok" />);
  expect(await screen.findByTestId("fake-terminal")).toBeInTheDocument();
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
  });

  it("labels the pane for assistive technology", async () => {
    await renderPane();
    expect(screen.getByRole("group", { name: /terminal 2/i })).toBeInTheDocument();
  });
});
