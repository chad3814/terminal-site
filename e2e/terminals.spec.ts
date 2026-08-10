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
}

function pane(page: Page, index: number) {
  return page.getByRole("group", { name: `Terminal ${index + 1}` });
}

// Keystrokes sent immediately after connecting can reach the server before
// the tmux session is attached: `sendInput` only waits for the WebSocket to
// be open, not for the "ready" control message, so a client typing as fast
// as Playwright does can have its first bytes silently dropped server-side
// (see server/pty-session.ts `start()`, where `pty` is still null). A human
// never types quickly enough to hit this window. Retrying the whole
// click-type-enter sequence until the marker lands works around the race
// without weakening what is actually asserted — the exact marker text must
// still appear.
async function typeInPane(page: Page, index: number, text: string, marker: string): Promise<void> {
  const target = pane(page, index);
  await expect(async () => {
    await target.click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await expect(target).toContainText(marker, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
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

  await typeInPane(page, 1, "echo ISOLATION_MARKER", "ISOLATION_MARKER");

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

  await typeInPane(page, 2, "echo PERSIST_MARKER", "PERSIST_MARKER");
  await expect(pane(page, 2)).toContainText("PERSIST_MARKER");

  await page.reload();

  await expect(pane(page, 2)).toContainText("PERSIST_MARKER");
});
