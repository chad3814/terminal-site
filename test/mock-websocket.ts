import { vi } from "vitest";

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  binaryType = "blob";
  readyState: number = MockWebSocket.CONNECTING;
  sent: (string | ArrayBufferLike | ArrayBufferView)[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string | ArrayBuffer>) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test helper: complete the connection. */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: deliver a server frame. */
  receive(data: string | ArrayBuffer): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static last(): MockWebSocket {
    const socket = MockWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error("no MockWebSocket was constructed");
    return socket;
  }

  static install(): void {
    vi.stubGlobal("WebSocket", MockWebSocket);
  }

  static textFrames(socket: MockWebSocket): string[] {
    return socket.sent.filter((frame): frame is string => typeof frame === "string");
  }
}
