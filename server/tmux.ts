import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

export const TMUX_SESSION_PREFIX = "termsite-";

export function tmuxSessionName(pane: number): string {
  return `${TMUX_SESSION_PREFIX}${pane}`;
}

/**
 * `-A` attaches to the session if it exists and creates it otherwise.
 * `-D` detaches any other client first, so the browser pane always owns
 * sizing — tmux otherwise sizes a session to its smallest attached client.
 */
export function tmuxArgs(pane: number): string[] {
  return ["new-session", "-A", "-D", "-s", tmuxSessionName(pane)];
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
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}
