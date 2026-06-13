// One-off DOM inspector to calibrate selectors against the live, paired page.
// Headed (the SPA crashes headless). Uses the same persistent profile (already paired).
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";

const PROFILE_DIR =
  process.env.GM_PROFILE_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "google-messages-mcp", "profile");

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1100, height: 800 } });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://messages.google.com/web/conversations", { waitUntil: "domcontentloaded" });

const attrs = (el) => {
  if (!el) return null;
  const o = { tag: el.tagName.toLowerCase() };
  for (const a of el.attributes) o[a.name] = a.value.slice(0, 80);
  return o;
};

// Phase 1: wait for the conversation list to populate
await page.waitForSelector("mws-conversation-list-item", { timeout: 25000 }).catch(() => {});
const listInfo = await page.evaluate(() => {
  const items = document.querySelectorAll("mws-conversation-list-item");
  const first = items[0];
  return {
    itemCount: items.length,
    firstItemHTML: first ? first.outerHTML.slice(0, 1200) : null,
  };
});

// Phase 2: open the first conversation to reveal compose box, send button, messages
let convoInfo = {};
const firstItem = page.locator("mws-conversation-list-item").first();
if (await firstItem.count()) {
  await firstItem.click();
  await page.waitForTimeout(3000);
  convoInfo = await page.evaluate(() => {
    const fattrs = (el) => {
      if (!el) return null;
      const o = { tag: el.tagName.toLowerCase() };
      for (const a of el.attributes) o[a.name] = a.value.slice(0, 80);
      return o;
    };
    const msgTags = {};
    document.querySelectorAll("*").forEach((el) => {
      const t = el.tagName.toLowerCase();
      if (t.includes("message") || t.includes("msg") || t.includes("text-")) msgTags[t] = (msgTags[t] || 0) + 1;
    });
    const wrap = document.querySelector("mws-message-wrapper");
    return {
      textareas: [...document.querySelectorAll("textarea")].map(fattrs),
      labeledButtons: [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")),
      messageRelatedTags: msgTags,
      firstMessageWrapperHTML: wrap ? wrap.outerHTML.slice(0, 900) : null,
    };
  });
}

console.log(JSON.stringify({ listInfo, convoInfo }, null, 2));
await ctx.close();
