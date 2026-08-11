/**
 * Incremental scanner that pulls terminal title changes out of a raw PTY byte
 * stream.
 *
 * This exists because `@wterm/ghostty` does not implement titles: its
 * `getTitle()` returns null unconditionally ("a full stream handler would be
 * needed for title support"), so the `onTitle` callback on `<Terminal>` can
 * never fire while that core is in use. The built-in Zig core does implement
 * it, but switching cores would give up the full VT compliance the ghostty
 * dependency exists for. Scanning the bytes ourselves keeps both.
 *
 * The scanner only observes. Every byte is still written to the terminal
 * unchanged — the core ignores OSC sequences, so passing them through costs
 * nothing and keeps the stream intact.
 */

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
const RIGHT_BRACKET = 0x5d;
const SEMICOLON = 0x3b;

/**
 * Upper bound on a single in-flight sequence. A stream that opens an OSC and
 * never terminates it would otherwise grow this buffer without limit; a title
 * longer than this is not useful in a pane header anyway.
 */
export const OSC_TITLE_MAX_BYTES = 512;

/** OSC codes that carry a window title: 0 sets both, 1 icon, 2 window. */
const TITLE_CODES = new Set([0, 1, 2]);

type State = "idle" | "afterEsc" | "body" | "bodyAfterEsc";

export interface TitleScanner {
  /**
   * Feed the next chunk. Returns the most recent complete title contained in
   * it, or null if the chunk finished no sequence. State carries across calls,
   * so a sequence split over several chunks is still recognised.
   */
  push(chunk: Uint8Array): string | null;
  /** Drop any partial sequence. Call when reconnecting to a new session. */
  reset(): void;
}

export function createTitleScanner(): TitleScanner {
  const decoder = new TextDecoder();
  let state: State = "idle";
  let body: number[] = [];

  function abandon(): void {
    state = "idle";
    body = [];
  }

  /** `body` holds `Ps;Pt`; returns Pt when Ps names a title. */
  function finish(): string | null {
    const separator = body.indexOf(SEMICOLON);
    if (separator === -1) {
      abandon();
      return null;
    }

    const code = Number.parseInt(
      String.fromCharCode(...body.slice(0, separator)),
      10,
    );
    const text = decoder.decode(new Uint8Array(body.slice(separator + 1)));
    abandon();

    return TITLE_CODES.has(code) ? text : null;
  }

  return {
    reset: abandon,

    push(chunk: Uint8Array): string | null {
      let latest: string | null = null;

      for (const byte of chunk) {
        switch (state) {
          case "idle":
            if (byte === ESC) state = "afterEsc";
            break;

          case "afterEsc":
            // Only `ESC ]` opens an OSC. A second ESC restarts the candidate
            // rather than dropping it, so `ESC ESC ]` is still recognised.
            state = byte === RIGHT_BRACKET ? "body" : byte === ESC ? "afterEsc" : "idle";
            break;

          case "body":
            if (byte === BEL) {
              latest = finish() ?? latest;
            } else if (byte === ESC) {
              state = "bodyAfterEsc";
            } else if (body.length >= OSC_TITLE_MAX_BYTES) {
              abandon();
            } else {
              body.push(byte);
            }
            break;

          case "bodyAfterEsc":
            if (byte === BACKSLASH) {
              // ST terminator: ESC \
              latest = finish() ?? latest;
            } else {
              // Not a terminator, so the ESC belonged to the payload. Nothing
              // downstream reads a malformed title, so drop the sequence.
              abandon();
              if (byte === ESC) state = "afterEsc";
            }
            break;
        }
      }

      return latest;
    },
  };
}
