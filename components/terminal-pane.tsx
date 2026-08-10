"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import type { TerminalCore } from "@wterm/core";
import type { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import { usePtySocket } from "@/lib/use-pty-socket";
import "@wterm/react/css";
import styles from "./terminal-pane.module.css";

const WASM_PATH = "/ghostty-vt.wasm";

export interface TerminalPaneProps {
  pane: number;
  token: string;
  className?: string;
}

export function TerminalPane({ pane, token, className }: TerminalPaneProps): JSX.Element {
  // GhosttyCore is stateful — it owns the terminal buffer, dimensions, and
  // scrollback — so every pane needs its own instance. The .wasm itself is
  // fetched once and reused from HTTP cache.
  const [core, setCore] = useState<TerminalCore | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);

  const { ref, write } = useTerminal();

  const writeBytes = useCallback((data: Uint8Array) => write(data), [write]);

  const socket = usePtySocket({ pane, token, write: writeBytes });

  useEffect(() => {
    let cancelled = false;
    GhosttyCore.load({ wasmPath: WASM_PATH })
      .then((loaded) => {
        if (!cancelled) setCore(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCoreError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { connect, sendInput, sendResize, restart, status, errorMessage } = socket;

  const handleReady = useCallback(
    (wt: WTerm) => {
      connect(wt.cols, wt.rows);
    },
    [connect],
  );

  const label = `Terminal ${pane + 1}`;
  const paneClassName = className === undefined ? styles.pane : `${styles.pane} ${className}`;

  return (
    <section role="group" aria-label={label} className={paneClassName}>
      {core !== null && (
        <Terminal
          ref={ref}
          core={core}
          cols={80}
          rows={24}
          autoResize
          onReady={handleReady}
          onData={sendInput}
          onResize={sendResize}
          className={styles.terminal}
          style={{ borderRadius: 0, boxShadow: "none", padding: 0 }}
        />
      )}

      {coreError !== null && (
        <div className={styles.overlay}>
          <p className={`${styles.message} ${styles.error}`}>
            Failed to load terminal core: {coreError}
          </p>
        </div>
      )}

      {coreError === null && core === null && (
        <div className={styles.overlay}>
          <p className={styles.message}>Loading terminal core…</p>
        </div>
      )}

      {status === "error" && (
        <div className={styles.overlay}>
          <p className={`${styles.message} ${styles.error}`}>{errorMessage}</p>
          <button type="button" className={styles.restart} onClick={restart}>
            Restart
          </button>
        </div>
      )}

      {status === "ended" && (
        <div className={styles.overlay}>
          <p className={styles.message}>Session ended</p>
          <button type="button" className={styles.restart} onClick={restart}>
            Restart
          </button>
        </div>
      )}
    </section>
  );
}
