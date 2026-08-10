"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseServerMessage, serializeMessage } from "@/shared/protocol";

export const RESIZE_THROTTLE_MS = 50;

export type PaneStatus = "connecting" | "ready" | "ended" | "error";

export interface UsePtySocketOptions {
  pane: number;
  token: string;
  write: (data: Uint8Array) => void;
}

export interface UsePtySocket {
  status: PaneStatus;
  errorMessage: string | null;
  connect: (cols: number, rows: number) => void;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  restart: () => void;
}

function socketUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/terminal`;
}

export function usePtySocket({ pane, token, write }: UsePtySocketOptions): UsePtySocket {
  const [status, setStatus] = useState<PaneStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef({ cols: 80, rows: 24 });
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const erroredRef = useRef(false);

  // `write` changes identity every render; keep it in a ref so the socket
  // handlers do not need to be rebuilt.
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  const connect = useCallback(
    (cols: number, rows: number) => {
      socketRef.current?.close();
      sizeRef.current = { cols, rows };
      erroredRef.current = false;
      setErrorMessage(null);
      setStatus("connecting");

      const ws = new WebSocket(socketUrl());
      ws.binaryType = "arraybuffer";
      socketRef.current = ws;

      ws.onopen = () => {
        ws.send(serializeMessage({ type: "hello", token, pane, cols, rows }));
      };

      ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data === "string") {
          const msg = parseServerMessage(event.data);
          if (msg === null) return;
          if (msg.type === "ready") {
            setStatus("ready");
            return;
          }
          erroredRef.current = true;
          setErrorMessage(msg.message);
          setStatus("error");
          return;
        }
        writeRef.current(new Uint8Array(event.data));
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
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
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

  return { status, errorMessage, connect, sendInput, sendResize, restart };
}
