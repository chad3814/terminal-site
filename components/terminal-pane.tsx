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

/** Health shown by the header dot, collapsed from core-load and socket state. */
type PaneHealth = "pending" | "ready" | "ended" | "error";

const HEALTH_LABEL: Record<PaneHealth, string> = {
  pending: "connecting",
  ready: "connected",
  ended: "session ended",
  error: "error",
};

// `styles[...]` is `string | undefined` under noUncheckedIndexedAccess, and
// Vitest stubs CSS Modules, so fall back to an empty class rather than
// rendering the literal "undefined" into className.
const HEALTH_CLASS: Record<PaneHealth, string> = {
  pending: styles.healthPending ?? "",
  ready: styles.healthReady ?? "",
  ended: styles.healthEnded ?? "",
  error: styles.healthError ?? "",
};

export function TerminalPane({ pane, token, className }: TerminalPaneProps): JSX.Element {
  // GhosttyCore is stateful — it owns the terminal buffer, dimensions, and
  // scrollback — so every pane needs its own instance. The .wasm itself is
  // fetched once and reused from HTTP cache.
  const [core, setCore] = useState<TerminalCore | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);

  // Scanned out of the PTY stream when tmux emits an OSC 0 sequence, which it
  // only does because tmuxArgs turns `set-titles` on for our sessions. Null
  // until the first one arrives.
  const [title, setTitle] = useState<string | null>(null);

  const { ref, write } = useTerminal();

  // wterm's own `<Terminal onTitle>` is deliberately not used: it is driven by
  // the core's getTitle(), and @wterm/ghostty returns null unconditionally, so
  // it can never fire here. usePtySocket scans the PTY stream instead.
  const handleTitle = useCallback((next: string) => {
    setTitle(next);
  }, []);

  const socket = usePtySocket({ pane, token, write, onTitle: handleTitle });

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

  const health: PaneHealth =
    coreError !== null || status === "error"
      ? "error"
      : status === "ended"
        ? "ended"
        : core !== null && status === "ready"
          ? "ready"
          : "pending";

  return (
    <section role="group" aria-label={label} className={paneClassName}>
      <header className={styles.header}>
        {/*
          The dot carries meaning in colour alone, so it is exposed as an image
          with a name rather than hidden. An aria-label is deliberate over
          visually-hidden text: real text content here would collide with the
          overlay's own "Connecting…" in `getByText` queries.
        */}
        <span
          className={`${styles.dot} ${HEALTH_CLASS[health]}`}
          role="img"
          aria-label={HEALTH_LABEL[health]}
        />
        {/*
          The title is content, not identity. The pane's accessible name stays
          `Terminal N` so it remains addressable while the title churns with
          every cd and command — the grid and the Playwright suite both locate
          panes by that name.
        */}
        {/*
          `||`, not `??`: the scanner faithfully reports an empty title for
          `ESC ] 0 ; BEL`, which some programs send to clear the title. Our own
          set-titles-string can never expand to empty, but the scanner reads
          whatever the shell emits, and a blank header reads as broken.
        */}
        <span className={styles.title}>{title || label}</span>
      </header>

      <div className={styles.body}>
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
      </div>
    </section>
  );
}
