// Probe how the conversation list loads more items on scroll (read-only).
// Respects GM_HEADLESS for experimental headless testing (may crash the SPA).
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
const dir =
  process.env.GM_PROFILE_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "google-messages-mcp", "profile");
const headlessEnv = process.env.GM_HEADLESS || process.env.HEADLESS || "";
const headless =
  headlessEnv === "true" || headlessEnv === "1" ? true : headlessEnv === "new" ? "new" : false;

const baseArgs = ["--disable-blink-features=AutomationControlled"];
const headlessArgs = headless
  ? [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--use-gl=swiftshader",
    ]
  : [];

const ctx = await chromium.launchPersistentContext(dir, {
  headless,
  viewport: { width: 1100, height: 800 },
  args: [...baseArgs, ...headlessArgs],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://messages.google.com/web/conversations", { waitUntil: "domcontentloaded" });
await page.waitForSelector("mws-conversation-list-item", { timeout: 25000 }).catch(() => {});

const namesNow = () =>
  page.$$eval("mws-conversation-list-item [data-e2e-conversation-name]", (els) =>
    els.map((e) => e.textContent.trim()),
  );
const domCount = () => page.locator("mws-conversation-list-item").count();

const seen = new Set();
(await namesNow()).forEach((n) => seen.add(n));
const startDom = await domCount();
const startUnique = seen.size;

// Identify the scroll container (nearest scrollable ancestor of the list items)
const scrollInfo = await page.evaluate(() => {
  const item = document.querySelector("mws-conversation-list-item");
  let el = item;
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 5) {
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").slice(0, 60),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    }
    el = el.parentElement;
  }
  return null;
});

// Scroll several times, accumulating unique names
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => {
    const item = document.querySelector("mws-conversation-list-item");
    let el = item;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 5) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      el = el.parentElement;
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(700);
  (await namesNow()).forEach((n) => seen.add(n));
}

console.log(
  JSON.stringify(
    {
      scrollContainer: scrollInfo,
      domCount_start: startDom,
      domCount_end: await domCount(),
      uniqueNames_start: startUnique,
      uniqueNames_afterScroll: seen.size,
    },
    null,
    2,
  ),
);
await ctx.close();
