import { defineConfig } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Without this, Playwright tears down the webServer with an immediate
    // SIGKILL to the process group, which server.ts's SIGTERM/SIGINT
    // handler can never catch — leaving every open pane's local tmux
    // client (which node-pty spawns in its own detached session, so a
    // process-group signal cannot reach it either way) orphaned and
    // reparented to pid 1. SIGTERM first gives that handler a chance to
    // close each socket and let the already-wired-up "close" handler run
    // pty.kill() (SIGHUP — detaches the tmux client without touching the
    // session) before anything is force-killed.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
