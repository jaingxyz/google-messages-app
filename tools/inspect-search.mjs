// Read-only inspector to locate the search UI in Messages web. No mutations.
// Respects GM_HEADLESS for experimental headless testing.
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";

const PROFILE_DIR =
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

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless,
  viewport: { width: 1100, height: 800 },
  args: [...baseArgs, ...headlessArgs],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://messages.google.com/web/conversations", { waitUntil: "domcontentloaded" });
await page.waitForSelector("mws-conversation-list-item", { timeout: 25000 }).catch(() => {});

const probe = async (label) =>
  page.evaluate((label) => {
    const attrs = (el) => {
      const o = { tag: el.tagName.toLowerCase() };
      for (const a of el.attributes) o[a.name] = (a.value || "").slice(0, 50);
      return o;
    };
    return {
      label,
      buttonsWithLabel: [...document.querySelectorAll("button[aria-label]")].map((b) =>
        b.getAttribute("aria-label"),
      ),
      inputs: [...document.querySelectorAll("input")].map(attrs),
      searchTags: [...document.querySelectorAll("*")]
        .map((e) => e.tagName.toLowerCase())
        .filter((t) => t.includes("search"))
        .reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {}),
    };
  }, label);

const out = { initial: await probe("conversations-view") };

// Try clicking a search affordance if one exists, then re-probe for the input.
const candidates = [
  "button[aria-label*='Search' i]",
  "mw-search-bar",
  "[data-e2e-search-button]",
  "mws-search-bar",
];
for (const sel of candidates) {
  const loc = page.locator(sel).first();
  if (await loc.count()) {
    out.clicked = sel;
    await loc.click().catch(() => {});
    await page.waitForTimeout(1200);
    out.afterClick = await probe("after-search-click");
    break;
  }
}

console.log(JSON.stringify(out, null, 2));
await ctx.close();
