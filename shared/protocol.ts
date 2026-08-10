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

/**
 * Machine-readable discriminator for error frames the client must react to
 * differently. `message` stays human-readable and unstable; anything the UI
 * branches on belongs here so the client never string-matches prose.
 *
 * - `unauthorized` — the boot token did not match. In practice this means the
 *   server restarted since the page was rendered, so reconnecting with the
 *   same token can never succeed and the page must be reloaded.
 *
 * `ERROR_CODES` is the single source of truth: the union is derived from it,
 * so adding a code cannot leave the runtime validator behind.
 */
const ERROR_CODES = ["unauthorized"] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorMessage {
  type: "error";
  message: string;
  code?: ErrorCode;
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

function isErrorCode(value: JsonValue | undefined): value is ErrorCode {
  const codes: readonly string[] = ERROR_CODES;
  return typeof value === "string" && codes.includes(value);
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
    // `code` is optional, but an unrecognised one is a shape this build does
    // not understand — reject rather than silently degrade to a codeless
    // error, which is exactly the ambiguity the field exists to remove.
    if (obj.code === undefined) return { type: "error", message: obj.message };
    if (!isErrorCode(obj.code)) return null;
    return { type: "error", message: obj.message, code: obj.code };
  }

  return null;
}
