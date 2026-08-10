import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findTmux, tmuxArgs, tmuxEnv, tmuxSessionName } from "./tmux";

const createdDirs: string[] = [];

describe("tmuxSessionName", () => {
  it("prefixes the pane index so it cannot collide with user sessions", () => {
    expect(tmuxSessionName(0)).toBe("termsite-0");
    expect(tmuxSessionName(3)).toBe("termsite-3");
  });
});

describe("tmuxArgs", () => {
  it("attaches-or-creates and detaches other clients", () => {
    expect(tmuxArgs(2)).toEqual([
      "new-session",
      "-A",
      "-D",
      "-s",
      "termsite-2",
    ]);
  });
});

describe("tmuxEnv", () => {
  it("strips TMUX so a nested tmux does not refuse to launch", () => {
    const env = tmuxEnv({ TMUX: "/tmp/sock,123,0", TMUX_PANE: "%4", HOME: "/h" });
    expect(env.TMUX).toBeUndefined();
    expect(env.TMUX_PANE).toBeUndefined();
    expect(env.HOME).toBe("/h");
  });

  it("pins TERM and drops undefined values", () => {
    const env = tmuxEnv({ TERM: "dumb", NOPE: undefined });
    expect(env.TERM).toBe("xterm-256color");
    expect("NOPE" in env).toBe(false);
  });
});

describe("findTmux", () => {
  afterEach(async () => {
    for (const dir of createdDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        // Ignore errors if directory was already cleaned or doesn't exist
      });
    }
    createdDirs.length = 0;
  });

  it("returns null when PATH is empty or unset", async () => {
    await expect(findTmux(undefined)).resolves.toBeNull();
    await expect(findTmux("")).resolves.toBeNull();
  });

  it("finds an executable tmux on PATH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmux-probe-"));
    createdDirs.push(dir);
    const bin = join(dir, "tmux");
    await writeFile(bin, "#!/bin/sh\nexit 0\n");
    await chmod(bin, 0o755);
    await expect(findTmux(`/nonexistent:${dir}`)).resolves.toBe(bin);
  });

  it("ignores a non-executable file named tmux", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmux-probe-"));
    createdDirs.push(dir);
    const bin = join(dir, "tmux");
    await writeFile(bin, "not executable");
    await chmod(bin, 0o644);
    await expect(findTmux(dir)).resolves.toBeNull();
  });

  it("ignores a directory named tmux even if executable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmux-probe-"));
    createdDirs.push(dir);
    const tmuxDir = join(dir, "tmux");
    await mkdir(tmuxDir, { mode: 0o755 });
    await expect(findTmux(dir)).resolves.toBeNull();
  });
});
