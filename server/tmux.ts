import { access, constants, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

export const TMUX_SESSION_PREFIX = "termsite-";

export function tmuxSessionName(pane: number): string {
  return `${TMUX_SESSION_PREFIX}${pane}`;
}

/**
 * Title shown in each pane's header. tmux expands this and emits it as an
 * OSC 0 sequence, which the terminal core surfaces through `onTitle`.
 * `#{b:...}` is tmux's basename modifier, so a deep path stays short enough
 * for a quarter-width pane.
 */
export const TMUX_TITLE_FORMAT = "#{pane_current_command} · #{b:pane_current_path}";

/**
 * How often tmux redraws the status line for our sessions, in seconds — which
 * is also how often it re-evaluates and emits the title. See `tmuxArgs`.
 */
export const TMUX_STATUS_INTERVAL_SECONDS = 1;

/**
 * `-A` attaches to the session if it exists and creates it otherwise.
 * `-D` detaches any other client first, so the browser pane always owns
 * sizing — tmux otherwise sizes a session to its smallest attached client.
 *
 * The `set-option` commands after the `;` separators enable title reporting.
 * All are *session* options targeted at our own session, so the user's global
 * tmux settings and any sessions of their own are untouched, and re-running
 * them on an `-A` reattach is idempotent.
 *
 * - `set-titles on`: off by default, and while off tmux never emits the OSC 0
 *   sequence at all, so the pane header would stay empty forever.
 * - `set-titles-string`: what the header shows.
 * - `status-interval 1`: tmux re-evaluates and emits the title on its periodic
 *   status redraw, *not* the moment the foreground command changes. At the
 *   default 15s — or the 5s this machine is configured with — any command
 *   shorter than the interval starts and finishes between ticks and its title
 *   is never emitted, so the header silently misses most of what you run.
 *   Measured: with the inherited interval a 3s `sleep` produced no title on
 *   either a fresh or a reattached session; at 1s it produced one every time.
 *   The cost is one status-line diff per second per pane, ~35 bytes/sec.
 */
export function tmuxArgs(pane: number): string[] {
  const session = tmuxSessionName(pane);
  return [
    "new-session",
    "-A",
    "-D",
    "-s",
    session,
    ";",
    "set-option",
    "-t",
    session,
    "set-titles",
    "on",
    ";",
    "set-option",
    "-t",
    session,
    "set-titles-string",
    TMUX_TITLE_FORMAT,
    ";",
    "set-option",
    "-t",
    session,
    "status-interval",
    String(TMUX_STATUS_INTERVAL_SECONDS),
  ];
}

/**
 * `TMUX` must be stripped: if the dev server was started from inside a tmux
 * session the child inherits it and nested tmux refuses to launch.
 */
export function tmuxEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.TMUX;
  delete env.TMUX_PANE;
  env.TERM = "xterm-256color";
  return env;
}

export async function findTmux(pathEnv: string | undefined): Promise<string | null> {
  if (pathEnv === undefined || pathEnv === "") return null;

  for (const dir of pathEnv.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "tmux");
    try {
      const stats = await stat(candidate);
      if (!stats.isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}
