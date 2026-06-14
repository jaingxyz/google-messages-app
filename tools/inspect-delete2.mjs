// Diagnose the post-"Move to trash" state for a specific thread, and complete the
// deletion if a confirmation dialog is present. Dumps any dialog's buttons verbatim.
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";

const NAME = process.argv[2] || "74666";
const PROFILE_DIR =
  process.env.GM_PROFILE_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "google-messages-mcp", "profile");

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1100, height: 800 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://messages.google.com/web/conversations", { waitUntil: "domcontentloaded" });
await page.waitForSelector("mws-conversation-list-item", { timeout: 25000 }).catch(() => {});

const dumpButtons = async () =>
  page.evaluate(() => {
    const inOverlay = [
      ...document.querySelectorAll(
        ".cdk-overlay-container button, mat-dialog-container button, [role='dialog'] button, [role='menuitem']",
      ),
    ];
    return inOverlay
      .map((el) => ({
        text: (el.textContent || "").trim().slice(0, 50),
        aria: el.getAttribute("aria-label"),
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        cls: (el.getAttribute("class") || "").slice(0, 50),
      }))
      .filter((b) => b.text || b.aria);
  });

// locate the item by exact name
const items = page.locator("mws-conversation-list-item");
const count = await items.count();
let target = null;
for (let i = 0; i < count; i++) {
  const nm = (
    await items
      .nth(i)
      .locator("[data-e2e-conversation-name], h2.name, .name")
      .first()
      .textContent()
      .catch(() => "")
  )?.trim();
  if ((nm || "").toLowerCase() === NAME.toLowerCase()) {
    target = items.nth(i);
    break;
  }
}
if (!target) {
  console.log(JSON.stringify({ error: `no exact match for "${NAME}"` }));
  await ctx.close();
  process.exit(0);
}

await target.hover();
await page.waitForTimeout(300);
await target.locator("button[aria-label^='Options for' i]").first().click();
await page.waitForTimeout(600);
const menu = await dumpButtons();

await page
  .locator("[role='menuitem']", { hasText: /move to trash/i })
  .first()
  .click();
await page.waitForTimeout(1000);
const afterTrashClick = await dumpButtons();

// If a confirmation dialog button is present, click the affirmative one to finish.
let confirmed = null;
const confirmBtn = page
  .locator("mat-dialog-container button, [role='dialog'] button", {
    hasText: /trash|delete|confirm|ok|yes/i,
  })
  .first();
if ((await confirmBtn.count()) && (await confirmBtn.isVisible().catch(() => false))) {
  confirmed = (await confirmBtn.textContent())?.trim();
  await confirmBtn.click();
  await page.waitForTimeout(1200);
}

// Is it gone now?
let stillThere = false;
const c2 = await items.count();
for (let i = 0; i < c2; i++) {
  const nm = (
    await items
      .nth(i)
      .locator("[data-e2e-conversation-name], h2.name, .name")
      .first()
      .textContent()
      .catch(() => "")
  )?.trim();
  if ((nm || "").toLowerCase() === NAME.toLowerCase()) {
    stillThere = true;
    break;
  }
}

console.log(
  JSON.stringify(
    { name: NAME, menu, afterTrashClick, confirmedButton: confirmed, stillThere },
    null,
    2,
  ),
);
await ctx.close();
