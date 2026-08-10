"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  DEFAULT_SPLIT,
  SPLIT_STORAGE_KEY,
  gridTemplate,
  parseStoredSplit,
  serializeSplit,
  type SplitState,
} from "@/lib/split-layout";
import { SplitDivider } from "./split-divider";
import { TerminalPane } from "./terminal-pane";
import styles from "./terminal-grid.module.css";

export interface TerminalGridProps {
  token: string;
}

const CELL_CLASSES = [styles.cell00, styles.cell01, styles.cell10, styles.cell11];

export function TerminalGrid({ token }: TerminalGridProps): JSX.Element {
  // Start from the default rather than reading localStorage during render:
  // the server renders this markup too, and a mismatch would break hydration.
  const [split, setSplit] = useState<SplitState>(DEFAULT_SPLIT);
  const [restored, setRestored] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSplit(parseStoredSplit(window.localStorage.getItem(SPLIT_STORAGE_KEY)));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    window.localStorage.setItem(SPLIT_STORAGE_KEY, serializeSplit(split));
  }, [restored, split]);

  const setCol = useCallback((col: number) => {
    setSplit((prev) => ({ ...prev, col }));
  }, []);

  const setRow = useCallback((row: number) => {
    setSplit((prev) => ({ ...prev, row }));
  }, []);

  return (
    <main
      ref={containerRef}
      className={styles.grid}
      style={{
        gridTemplateColumns: gridTemplate(split.col),
        gridTemplateRows: gridTemplate(split.row),
      }}
    >
      {CELL_CLASSES.map((cellClass, pane) => (
        <TerminalPane key={pane} pane={pane} token={token} className={cellClass} />
      ))}

      <SplitDivider
        orientation="vertical"
        percent={split.col}
        label="Resize columns"
        containerRef={containerRef}
        onChange={setCol}
      />
      <SplitDivider
        orientation="horizontal"
        percent={split.row}
        label="Resize rows"
        containerRef={containerRef}
        onChange={setRow}
      />
    </main>
  );
}
