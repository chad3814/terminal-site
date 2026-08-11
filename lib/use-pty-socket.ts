"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseServerMessage, serializeMessage, type ErrorCode } from "@/shared/protocol";
import { createTitleScanner, type TitleScanner } from "./osc-title";

export const RESIZE_THROTTLE_MS = 50;

export type PaneStatus = "connecting" | "ready" | "ended" | "error";

export interface UsePtySocketOptions {
  pane: number;
  token: string;
  write: (data: Uint8Array) => void;
  /**
   * Called when the shell reports a new terminal title. Sourced by scanning
   * the PTY stream for OSC sequences rather than from the terminal core:
   * `@wterm/ghostty` never reports titles, so `<Terminal onTitle>` is inert
   * for us. See lib/osc-title.ts.
   */
  onTitle?: (title: string) => void;
}

export interface UsePtySocket {
  status: PaneStatus;
  errorMessage: string | null;
  errorCode: ErrorCode | null;
  connect: (cols: number, rows: number) => void;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  restart: () => void;
}

function socketUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/terminal`;
}

export function usePtySocket({
  pane,
  token,
  write,
  onTitle,
}: UsePtySocketOptions): UsePtySocket {
  const [status, setStatus] = useState<PaneStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef({ cols: 80, rows: 24 });
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const erroredRef = useRef(false);

  // Mirrors `status === "ready"` in a ref so `sendInput`'s callback identity
  // can stay stable (empty deps) without ever reading a stale closure value.
  const readyRef = useRef(false);

  // Input typed or pasted before the session reports "ready" is queued here
  // instead of being sent (and silently lost) or dropped on the floor: the
  // server does not assign its pty handle until "ready", so bytes written
  // any earlier never reach the shell (see server/pty-session.ts `start()`).
  // Gating `sendInput` on readiness instead of buffering would just turn
  // that rare drop into a guaranteed one for anything typed while
  // connecting. Flushed in order once "ready" arrives; cleared on every
  // `connect()` so a `restart()` never replays input meant for a session
  // that no longer exists.
  const pendingInputRef = useRef<string[]>([]);

  // `write` changes identity every render; keep it in a ref so the socket
  // handlers do not need to be rebuilt.
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  const onTitleRef = useRef(onTitle);
  useEffect(() => {
    onTitleRef.current = onTitle;
  }, [onTitle]);

  // Stateful across chunks: an OSC sequence can straddle two frames.
  const titleScannerRef = useRef<TitleScanner | null>(null);
  if (titleScannerRef.current === null) {
    titleScannerRef.current = createTitleScanner();
  }

  const connect = useCallback(
    (cols: number, rows: number) => {
      socketRef.current?.close();
      sizeRef.current = { cols, rows };
      erroredRef.current = false;
      readyRef.current = false;
      pendingInputRef.current = [];
      // A half-read sequence from the dead socket must not be completed by
      // the first bytes of the new one.
      titleScannerRef.current?.reset();
      setErrorMessage(null);
      setErrorCode(null);
      setStatus("connecting");

      const ws = new WebSocket(socketUrl());
      ws.binaryType = "arraybuffer";
      socketRef.current = ws;

      ws.onopen = () => {
        // Read the size at handshake time, not the values captured when
        // `connect()` was called: a resize landing during the (async) open
        // updates `sizeRef` but is dropped by `sendResize` while the socket
        // is not yet OPEN, so stale dimensions here would size tmux wrong
        // until the next resize.
        const size = sizeRef.current;
        ws.send(
          serializeMessage({
            type: "hello",
            token,
            pane,
            cols: size.cols,
            rows: size.rows,
          }),
        );
      };

      ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data === "string") {
          const msg = parseServerMessage(event.data);
          if (msg === null) return;
          if (msg.type === "ready") {
            readyRef.current = true;
            const queued = pendingInputRef.current;
            pendingInputRef.current = [];
            for (const chunk of queued) {
              ws.send(new TextEncoder().encode(chunk));
            }
            setStatus("ready");
            return;
          }
          erroredRef.current = true;
          setErrorMessage(msg.message);
          setErrorCode(msg.code ?? null);
          setStatus("error");
          return;
        }
        const bytes = new Uint8Array(event.data);
        // Observe before writing: the scanner only reads, and the core ignores
        // OSC sequences, so the terminal still receives the stream unchanged.
        const nextTitle = titleScannerRef.current?.push(bytes) ?? null;
        if (nextTitle !== null) onTitleRef.current?.(nextTitle);
        writeRef.current(bytes);
      };

      ws.onclose = () => {
        // A superseded socket can still deliver a close event after
        // `connect()` has already moved on to a new one; only the current
        // socket's close may affect state.
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        if (!erroredRef.current) setStatus("ended");
      };
    },
    [pane, token],
  );

  const restart = useCallback(() => {
    const { cols, rows } = sizeRef.current;
    connect(cols, rows);
  }, [connect]);

  const sendInput = useCallback((data: string) => {
    const ws = socketRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN || !readyRef.current) {
      pendingInputRef.current.push(data);
      return;
    }
    ws.send(new TextEncoder().encode(data));
  }, []);

  // Dragging a divider fires ResizeObserver at frame rate, and tmux redraws
  // the whole screen on every resize. Send only a trailing frame.
  const sendResize = useCallback((cols: number, rows: number) => {
    sizeRef.current = { cols, rows };
    if (resizeTimerRef.current !== null) return;

    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      const ws = socketRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      const size = sizeRef.current;
      ws.send(serializeMessage({ type: "resize", cols: size.cols, rows: size.rows }));
    }, RESIZE_THROTTLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  return { status, errorMessage, errorCode, connect, sendInput, sendResize, restart };
}
