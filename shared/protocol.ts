import { isJsonObject, parseJson, type JsonObject, type JsonValue } from "./json";

export const PANE_COUNT = 4;

const MIN_DIMENSION = 1;
const MAX_DIMENSION = 10_000;

export interface HelloMessage {
  type: "hello";
  token: string;
  pane: number;
  cols: number;
  rows: number;
}

export interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

export interface ReadyMessage {
  type: "ready";
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ClientMessage = HelloMessage | ResizeMessage;
export type ServerMessage = ReadyMessage | ErrorMessage;

export function serializeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

function isDimension(value: JsonValue | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_DIMENSION &&
    value <= MAX_DIMENSION
  );
}

function isPaneIndex(value: JsonValue | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < PANE_COUNT
  );
}

function asObject(raw: string): JsonObject | null {
  const parsed = parseJson(raw);
  if (parsed === null) return null;
  return isJsonObject(parsed) ? parsed : null;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  const obj = asObject(raw);
  if (obj === null) return null;

  if (obj.type === "hello") {
    if (typeof obj.token !== "string") return null;
    if (!isPaneIndex(obj.pane)) return null;
    if (!isDimension(obj.cols) || !isDimension(obj.rows)) return null;
    return {
      type: "hello",
      token: obj.token,
      pane: obj.pane,
      cols: obj.cols,
      rows: obj.rows,
    };
  }

  if (obj.type === "resize") {
    if (!isDimension(obj.cols) || !isDimension(obj.rows)) return null;
    return { type: "resize", cols: obj.cols, rows: obj.rows };
  }

  return null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  const obj = asObject(raw);
  if (obj === null) return null;

  if (obj.type === "ready") return { type: "ready" };

  if (obj.type === "error") {
    if (typeof obj.message !== "string") return null;
    return { type: "error", message: obj.message };
  }

  return null;
}
