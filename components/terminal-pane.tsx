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

interface OverlayAction {
  label: string;
  onClick: () => void;
}

interface OverlayContent {
  message: string;
  isError: boolean;
  action: OverlayAction | null;
}

export function TerminalPane({ pane, token, className }: TerminalPaneProps): JSX.Element {
  // GhosttyCore is stateful — it owns the terminal buffer, dimensions, and
  // scrollback — so every pane needs its own instance. The .wasm itself is
  // fetched once and reused from HTTP cache.
  const [core, setCore] = useState<TerminalCore | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);

  const { ref, write } = useTerminal();

  const socket = usePtySocket({ pane, token, write });

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

  const { connect, sendInput, sendResize, restart, status, errorMessage, errorCode } = socket;

  const handleReady = useCallback(
    (wt: WTerm) => {
      connect(wt.cols, wt.rows);
    },
    [connect],
  );

  const reload = useCallback(() => {
    window.location.reload();
  }, []);

  const label = `Terminal ${pane + 1}`;
  const paneClassName = className === undefined ? styles.pane : `${styles.pane} ${className}`;

  // Exactly one overlay, chosen most-fatal first. Rendering these as
  // independent conditionals let a core-load failure and a socket error stack
  // two `inset: 0` panels on top of each other, with the later one silently
  // hiding the earlier.
  const overlay = ((): OverlayContent | null => {
    if (coreError !== null) {
      return {
        message: `Failed to load terminal core: ${coreError}`,
        isError: true,
        action: null,
      };
    }
    if (status === "error") {
      // The boot token is per-process and baked into the page HTML, so a
      // rejected token means the server restarted since this page rendered.
      // Reconnecting replays the same dead token; only a reload can fix it.
      if (errorCode === "unauthorized") {
        return {
          message: "Server restarted — reload the page",
          isError: true,
          action: { label: "Reload", onClick: reload },
        };
      }
      return {
        message: errorMessage ?? "Terminal error",
        isError: true,
        action: { label: "Restart", onClick: restart },
      };
    }
    if (status === "ended") {
      return {
        message: "Session ended",
        isError: false,
        action: { label: "Restart", onClick: restart },
      };
    }
    if (core === null) {
      return { message: "Loading terminal core…", isError: false, action: null };
    }
    if (status === "connecting") {
      // Without this a pane whose handshake never completes is
      // indistinguishable from a working one that simply has no output yet.
      return { message: "Connecting…", isError: false, action: null };
    }
    return null;
  })();

  // An overlay with a button must take clicks; one without must not steal them
  // from the terminal it is covering.
  const overlayClassName =
    overlay !== null && overlay.action !== null
      ? styles.overlay
      : `${styles.overlay} ${styles.passive}`;

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

      {overlay !== null && (
        <div className={overlayClassName}>
          <p className={overlay.isError ? `${styles.message} ${styles.error}` : styles.message}>
            {overlay.message}
          </p>
          {overlay.action !== null && (
            <button type="button" className={styles.restart} onClick={overlay.action.onClick}>
              {overlay.action.label}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
