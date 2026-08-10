import { describe, expect, it } from "vitest";
import {
  PANE_COUNT,
  parseClientMessage,
  parseServerMessage,
  serializeMessage,
} from "./protocol";

describe("serializeMessage", () => {
  it("round-trips a hello message", () => {
    const raw = serializeMessage({
      type: "hello",
      token: "abc",
      pane: 0,
      cols: 80,
      rows: 24,
    });
    expect(parseClientMessage(raw)).toEqual({
      type: "hello",
      token: "abc",
      pane: 0,
      cols: 80,
      rows: 24,
    });
  });

  it("round-trips a resize message", () => {
    const raw = serializeMessage({ type: "resize", cols: 100, rows: 30 });
    expect(parseClientMessage(raw)).toEqual({ type: "resize", cols: 100, rows: 30 });
  });

  it("round-trips server messages", () => {
    expect(parseServerMessage(serializeMessage({ type: "ready" }))).toEqual({
      type: "ready",
    });
    expect(
      parseServerMessage(serializeMessage({ type: "error", message: "nope" })),
    ).toEqual({ type: "error", message: "nope" });
  });
});

describe("parseClientMessage", () => {
  it("rejects malformed and hostile input", () => {
    expect(parseClientMessage("")).toBeNull();
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage("[]")).toBeNull();
    expect(parseClientMessage("null")).toBeNull();
    expect(parseClientMessage('"hello"')).toBeNull();
    expect(parseClientMessage('{"type":"nope"}')).toBeNull();
    expect(parseClientMessage('{"type":"ready"}')).toBeNull();
  });

  it("rejects a hello with a bad pane index", () => {
    const bad = (pane: number): string =>
      JSON.stringify({ type: "hello", token: "t", pane, cols: 80, rows: 24 });
    expect(parseClientMessage(bad(-1))).toBeNull();
    expect(parseClientMessage(bad(PANE_COUNT))).toBeNull();
    expect(parseClientMessage(bad(1.5))).toBeNull();
  });

  it("rejects non-integer and out-of-range dimensions", () => {
    expect(
      parseClientMessage('{"type":"resize","cols":0,"rows":24}'),
    ).toBeNull();
    expect(
      parseClientMessage('{"type":"resize","cols":80,"rows":100000}'),
    ).toBeNull();
    expect(
      parseClientMessage('{"type":"resize","cols":"80","rows":24}'),
    ).toBeNull();
  });

  it("rejects a hello with a non-string token", () => {
    expect(
      parseClientMessage('{"type":"hello","token":5,"pane":0,"cols":80,"rows":24}'),
    ).toBeNull();
  });
});
