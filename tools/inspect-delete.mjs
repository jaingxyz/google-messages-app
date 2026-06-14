// SAFE inspector for the delete flow. Opens the per-conversation Options menu and
// the delete confirmation dialog, dumps their structure, then presses Escape to
// CANCEL. It never clicks a confirm/delete button, so nothing is deleted.
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";

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

const dumpOverlay = async (label) => {
  return await page.evaluate((label) => {
    // Material menus/dialogs render in a CDK overlay container appended to <body>.
    const roots = [
      ...document.querySelectorAll(
        ".cdk-overlay-container, mat-menu, [role='menu'], mat-dialog-container, [role='dialog']",
      ),
    ];
    const buttons = [
      ...document.querySelectorAll(
        "[role='menuitem'], mat-dialog-container button, [role='dialog'] button, .mat-mdc-menu-item",
      ),
    ]
      .map((el) => ({
        text: (el.textContent || "").trim().slice(0, 40),
        aria: el.getAttribute("aria-label"),
        role: el.getAttribute("role"),
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") || "").slice(0, 60),
      }))
      .filter((b) => b.text || b.aria);
    return { label, overlayCount: roots.length, buttons };
  }, label);
};

const out = {};
try {
  const item = page.locator("mws-conversation-list-item").first();
  await item.hover();
  await page.waitForTimeout(400);
  // The per-row options button (aria-label "Options for <name>")
  const optBtn = item.locator("button[aria-label^='Options for' i]").first();
  await optBtn.click();
  await page.waitForTimeout(800);
  out.menu = await dumpOverlay("options-menu");

  // Click the "Delete" menu item to reveal the confirmation dialog (does NOT delete yet).
  const del = page.locator("[role='menuitem']", { hasText: /delete/i }).first();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(800);
    out.dialog = await dumpOverlay("confirm-dialog");
  } else {
    out.dialog = { note: "no Delete menuitem found" };
  }
} catch (e) {
  out.error = e.message;
} finally {
  // Cancel everything — Escape closes Material dialogs/menus without confirming.
  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
}

console.log(JSON.stringify(out, null, 2));
await ctx.close();
