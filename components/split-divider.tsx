"use client";

import {
  useCallback,
  useRef,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
  nudgeSplit,
  splitFromPointer,
} from "@/lib/split-layout";
import styles from "./split-divider.module.css";

export interface SplitDividerProps {
  orientation: "vertical" | "horizontal";
  percent: number;
  label: string;
  containerRef: RefObject<HTMLElement | null>;
  onChange: (percent: number) => void;
}

const DECREASE_KEYS: Record<"vertical" | "horizontal", string> = {
  vertical: "ArrowLeft",
  horizontal: "ArrowUp",
};

const INCREASE_KEYS: Record<"vertical" | "horizontal", string> = {
  vertical: "ArrowRight",
  horizontal: "ArrowDown",
};

export function SplitDivider({
  orientation,
  percent,
  label,
  containerRef,
  onChange,
}: SplitDividerProps): JSX.Element {
  const dragging = useRef(false);

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (container === null) return;
      const rect = container.getBoundingClientRect();
      const next =
        orientation === "vertical"
          ? splitFromPointer(clientX, rect.left, rect.width)
          : splitFromPointer(clientY, rect.top, rect.height);
      onChange(next);
    },
    [containerRef, onChange, orientation],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPointer(event.clientX, event.clientY);
    },
    [applyPointer],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      applyPointer(event.clientX, event.clientY);
    },
    [applyPointer],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handlePointerCancel = useCallback(() => {
    // No releasePointerCapture() here: per the Pointer Events spec, capture
    // is implicitly released by the browser before pointercancel fires, so
    // calling it again can throw NotFoundError. Clearing the ref is the fix.
    dragging.current = false;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 5 : 1;

      if (event.key === DECREASE_KEYS[orientation]) {
        event.preventDefault();
        onChange(nudgeSplit(percent, -step));
        return;
      }
      if (event.key === INCREASE_KEYS[orientation]) {
        event.preventDefault();
        onChange(nudgeSplit(percent, step));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        onChange(MIN_SPLIT_PERCENT);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        onChange(MAX_SPLIT_PERCENT);
      }
    },
    [onChange, orientation, percent],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={MIN_SPLIT_PERCENT}
      aria-valuemax={MAX_SPLIT_PERCENT}
      className={`${styles.divider} ${styles[orientation]}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    />
  );
}
