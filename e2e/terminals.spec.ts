import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
// Relative, not the "@/" alias: e2e/ is excluded from tsconfig.json, so the
// path mapping is not in scope for these files.
import { PANE_COUNT } from "../shared/protocol";

const execFileAsync = promisify(execFile);

async function hasTmux(): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

async function killSessions(): Promise<void> {
  for (let pane = 0; pane < PANE_COUNT; pane += 1) {
    try {
      await execFileAsync("tmux", ["kill-session", "-t", `termsite-${pane}`]);
    } catch {
      // Session may not exist; nothing to clean up.
    }
  }
  try {
    // Safety net: the dev server can be killed (e.g. by Playwright tearing
    // down its webServer) without running its socket-close handlers, which
    // is what normally kills the local tmux client process attached to each
    // session. `kill-session` above only reaches tmux's server and does not
    // clean up an orphaned client left over from an earlier run.
    await execFileAsync("pkill", ["-f", "tmux .*termsite-"]);
  } catch {
    // No matching processes; nothing to clean up.
  }
}

function pane(page: Page, index: number) {
  return page.getByRole("group", { name: `Terminal ${index + 1}` });
}

async function typeInPane(page: Page, index: number, text: string): Promise<void> {
  // Click the terminal's own input control, not the outer pane: the pane
  // (`role="group"`) is visible the instant the page loads, well before the
  // WASM core has been fetched and instantiated (~100-250ms locally), so a
  // click on the pane itself can land while only the "Loading terminal
  // core…" placeholder exists — focusing nothing. Targeting the input
  // control lets Playwright's normal actionability wait handle that startup
  // window instead of a manual delay or a retry of this whole function.
  await pane(page, index).getByRole("textbox").click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test.beforeAll(async () => {
  test.skip(!(await hasTmux()), "tmux is not installed on PATH");
  await killSessions();
});

test.afterAll(async () => {
  await killSessions();
});

test("every pane attaches to its own independent shell", async ({ page }) => {
  await page.goto("/");

  // Liveness before isolation. `role="group"` renders unconditionally, before
  // the WASM core loads and before any socket exists, so asserting on the
  // pane alone would let a `not.toContainText` pass for a pane that never
  // connected at all. `role="textbox"` only exists once the core has mounted,
  // so waiting on all of them pins "every core loaded" first.
  for (let index = 0; index < PANE_COUNT; index += 1) {
    await expect(pane(page, index).getByRole("textbox")).toBeVisible();
  }

  // A distinct marker per pane, so isolation is checked in both directions:
  // each marker must appear in its own pane and in no other.
  for (let index = 0; index < PANE_COUNT; index += 1) {
    await typeInPane(page, index, `echo MARKER_${index}`);
  }

  for (let source = 0; source < PANE_COUNT; source += 1) {
    for (let observer = 0; observer < PANE_COUNT; observer += 1) {
      if (source === observer) {
        await expect(pane(page, observer)).toContainText(`MARKER_${source}`);
      } else {
        await expect(pane(page, observer)).not.toContainText(`MARKER_${source}`);
      }
    }
  }
});

test("dragging the column divider reflows the panes", async ({ page }) => {
  await page.goto("/");

  const left = pane(page, 0);
  await expect(left).toBeVisible();
  const before = await left.boundingBox();

  const divider = page.getByRole("separator", { name: "Resize columns" });
  const box = await divider.boundingBox();
  if (box === null) throw new Error("divider has no bounding box");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await left.boundingBox();
  if (before === null || after === null) throw new Error("pane has no bounding box");
  expect(after.width).toBeLessThan(before.width - 100);
});

test("the divider is keyboard operable", async ({ page }) => {
  await page.goto("/");

  // Wait for hydration before pressing a key. Both separators are present in
  // the server-rendered HTML, complete with tabindex="0" and
  // aria-valuenow="50", so the locator matches and .focus() succeeds while
  // React has not yet attached the keydown handler — the press would then do
  // nothing and the value would still read 50. This was observed once on a
  // cold first compile. role="textbox" is client-only (it renders only after
  // the WASM core loads), so waiting on it proves the client is live.
  await pane(page, 0).getByRole("textbox").waitFor();

  const divider = page.getByRole("separator", { name: "Resize rows" });
  await divider.focus();
  await divider.press("Shift+ArrowUp");

  await expect(divider).toHaveAttribute("aria-valuenow", "45");
});

test("shells survive a page reload", async ({ page }) => {
  await page.goto("/");

  await typeInPane(page, 2, "echo PERSIST_MARKER");
  await expect(pane(page, 2)).toContainText("PERSIST_MARKER");

  await page.reload();

  await expect(pane(page, 2)).toContainText("PERSIST_MARKER");
});
