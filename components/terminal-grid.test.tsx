import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPLIT_STORAGE_KEY, serializeSplit } from "@/lib/split-layout";
import { PANE_COUNT } from "@/shared/protocol";

vi.mock("./terminal-pane", () => ({
  TerminalPane: ({ pane }: { pane: number }) => (
    <div data-testid={`pane-${pane}`}>pane {pane}</div>
  ),
}));

const { TerminalGrid } = await import("./terminal-grid");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TerminalGrid", () => {
  it("renders one pane per PANE_COUNT and two dividers", () => {
    render(<TerminalGrid token="tok" />);
    for (let pane = 0; pane < PANE_COUNT; pane += 1) {
      expect(screen.getByTestId(`pane-${pane}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId(`pane-${PANE_COUNT}`)).not.toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("defaults to a 50/50 cross", () => {
    render(<TerminalGrid token="tok" />);
    const [column, row] = screen.getAllByRole("separator");
    expect(column).toHaveAttribute("aria-valuenow", "50");
    expect(row).toHaveAttribute("aria-valuenow", "50");
  });

  it("moves the column split with the keyboard and persists it", () => {
    render(<TerminalGrid token="tok" />);
    const [column] = screen.getAllByRole("separator");
    if (column === undefined) throw new Error("missing separator");

    fireEvent.keyDown(column, { key: "ArrowRight", shiftKey: true });

    expect(column).toHaveAttribute("aria-valuenow", "55");
    expect(window.localStorage.getItem(SPLIT_STORAGE_KEY)).toBe(
      serializeSplit({ col: 55, row: 50 }),
    );
  });

  it("restores a stored layout after mount", () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, serializeSplit({ col: 25, row: 75 }));
    render(<TerminalGrid token="tok" />);
    const [column, row] = screen.getAllByRole("separator");
    expect(column).toHaveAttribute("aria-valuenow", "25");
    expect(row).toHaveAttribute("aria-valuenow", "75");
  });

  it("ignores corrupt stored layout", () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, "{{{");
    render(<TerminalGrid token="tok" />);
    const [column, row] = screen.getAllByRole("separator");
    expect(column).toHaveAttribute("aria-valuenow", "50");
    expect(row).toHaveAttribute("aria-valuenow", "50");
  });
});
