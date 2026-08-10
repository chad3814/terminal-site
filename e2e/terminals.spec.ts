import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";

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
  for (let pane = 0; pane < 4; pane += 1) {
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

test("four panes attach to four independent shells", async ({ page }) => {
  await page.goto("/");

  for (let index = 0; index < 4; index += 1) {
    await expect(pane(page, index)).toBeVisible();
  }

  await typeInPane(page, 1, "echo ISOLATION_MARKER");

  await expect(pane(page, 1)).toContainText("ISOLATION_MARKER");
  await expect(pane(page, 0)).not.toContainText("ISOLATION_MARKER");
  await expect(pane(page, 2)).not.toContainText("ISOLATION_MARKER");
  await expect(pane(page, 3)).not.toContainText("ISOLATION_MARKER");
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
