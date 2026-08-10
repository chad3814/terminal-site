import type { RefObject } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitDivider } from "./split-divider";

function renderDivider(orientation: "vertical" | "horizontal", percent = 50) {
  const onChange = vi.fn();
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 500 }) as DOMRect;
  // A plain object satisfies RefObject structurally. `createRef()` returns a
  // sealed object, so reassigning `current` on it is needlessly fragile.
  const containerRef: RefObject<HTMLElement | null> = { current: container };

  render(
    <SplitDivider
      orientation={orientation}
      percent={percent}
      label="Column split"
      containerRef={containerRef}
      onChange={onChange}
    />,
  );

  return { onChange, separator: screen.getByRole("separator") };
}

describe("SplitDivider", () => {
  it("exposes accessible separator semantics", () => {
    const { separator } = renderDivider("vertical", 40);
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "40");
    expect(separator).toHaveAttribute("aria-valuemin", "10");
    expect(separator).toHaveAttribute("aria-valuemax", "90");
    expect(separator).toHaveAttribute("aria-label", "Column split");
    expect(separator).toHaveAttribute("tabindex", "0");
  });

  it("moves by 1 percent on arrow keys", () => {
    const { onChange, separator } = renderDivider("vertical", 50);
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(51);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(49);
  });

  it("moves by 5 percent with shift held", () => {
    const { onChange, separator } = renderDivider("vertical", 50);
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it("uses the up and down keys for a horizontal divider", () => {
    const { onChange, separator } = renderDivider("horizontal", 50);
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(51);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("jumps to the limits on Home and End", () => {
    const { onChange, separator } = renderDivider("vertical", 50);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith(10);
    fireEvent.keyDown(separator, { key: "End" });
    expect(onChange).toHaveBeenCalledWith(90);
  });

  it("converts a pointer drag into a percentage", () => {
    // PointerEvent and pointer capture are polyfilled in test/setup.ts.
    const { onChange, separator } = renderDivider("vertical", 50);

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 300, clientY: 250 });
    expect(onChange).toHaveBeenLastCalledWith(30);

    fireEvent.pointerUp(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 800, clientY: 250 });
    expect(onChange).toHaveBeenLastCalledWith(30);
  });

  it("stops dragging when the pointer is cancelled", () => {
    const { onChange, separator } = renderDivider("vertical", 50);

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500, clientY: 250 });
    fireEvent.pointerCancel(separator, { pointerId: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 800, clientY: 250 });

    expect(onChange).toHaveBeenLastCalledWith(50);
  });
});
