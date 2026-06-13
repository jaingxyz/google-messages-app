// Playwright wrapper around Google Messages for web (messages.google.com/web).
//
// There is NO official Google Messages API, so everything here drives the web
// client's DOM. Google changes that DOM from time to time; when a tool starts
// failing, the fix is almost always in the SELECTORS block below. Use the
// `debug_snapshot` MCP tool to dump the live structure and re-derive selectors.

import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const URL = "https://messages.google.com/web/conversations";

// A normal desktop Chrome UA so Messages serves the full site (not "unsupported browser").
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Persistent profile = your paired session. Lives outside the repo so it survives.
const PROFILE_DIR =
  process.env.GM_PROFILE_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "google-messages-mcp", "profile");

// ---------------------------------------------------------------------------
// SELECTORS — the fragile part. Edit here when the UI changes.
// ---------------------------------------------------------------------------
// Verified against the live DOM 2026-06 (see tools/inspect.mjs to re-derive).
const SEL = {
  // QR pairing screen (shown when NOT paired)
  qr: "mw-qr-code, [data-e2e-qr-code], canvas[aria-label*='QR' i]",
  // Conversation list + items (shown when paired)
  convList: "mws-conversations-list, mws-conversation-list",
  convItem: "mws-conversation-list-item",
  convItemName: "[data-e2e-conversation-name], h2.name, .name",
  convItemSnippet: "mws-conversation-snippet, .snippet-text, .snippet",
  convItemUnread: "[data-e2e-is-unread='true']",
  // Open thread: message bubbles. Outgoing is the wrapper's `is-outgoing` attribute.
  messageWrapper: "mws-message-wrapper",
  messageText: "mws-text-message-part, .text-msg",
  // Compose box + send
  composeInput: "textarea[data-e2e-message-input-box], textarea[aria-label*='message' i]",
  sendButton: "mws-message-send-button button, button[aria-label*='Send' i]",
  // New conversation flow
  startChatButton: "mw-fab-link a, a[href*='conversations/new'], button[aria-label*='Start chat' i]",
  recipientInput: "input[aria-label*='recipient' i], input[aria-label*='name, phone' i], input[type='text']",
  recipientFirstResult: "mw-contact-selector-result, [data-e2e-contact-result], .contact-row",
  // Search (best-effort — not yet verified against the live UI)
  searchButton: "button[aria-label*='Search' i], [data-e2e-search-button]",
  searchInput: "input[aria-label*='Search' i], input[type='search']",
};

export class Messages {
  constructor({ headless = false } = {}) {
    this.headless = headless;
    this.context = null;
    this.page = null;
  }

  async ensureReady() {
    if (this.page && !this.page.isClosed()) return this.page;

    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    // All logs go to stderr — stdout is reserved for the MCP protocol.
    console.error(`[messages] launching Chromium (profile: ${PROFILE_DIR})`);

    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: this.headless,
      viewport: { width: 1100, height: 800 },
      userAgent: USER_AGENT,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    this.page = this.context.pages()[0] || (await this.context.newPage());
    await this.page.goto(URL, { waitUntil: "domcontentloaded" });
    // Wait until the SPA renders EITHER the conversation list items (paired) or the
    // QR screen (not paired) — the list loads behind a spinner, so a fixed delay isn't enough.
    await Promise.race([
      this.page.waitForSelector(SEL.convItem, { timeout: 25000 }).catch(() => {}),
      this.page.waitForSelector(SEL.qr, { timeout: 25000 }).catch(() => {}),
    ]);
    return this.page;
  }

  async pairingStatus() {
    const page = await this.ensureReady();
    const paired = (await page.locator(SEL.convItem).count().catch(() => 0)) > 0;
    if (paired) return { paired: true, message: "Paired — Messages session is active." };
    const qr = await page.locator(SEL.qr).first().isVisible().catch(() => false);
    if (qr) {
      return {
        paired: false,
        message:
          "NOT paired. A QR code is showing in the app window. On your phone: " +
          "Google Messages → Profile/menu → Device pairing → QR code scanner → scan it, " +
          "and tick 'Remember this computer'.",
      };
    }
    return { paired: false, message: "Could not determine pairing state — open the app window to check." };
  }

  async _requirePaired() {
    const s = await this.pairingStatus();
    if (!s.paired) throw new Error(s.message);
  }

  async listConversations(limit = 20) {
    await this._requirePaired();
    const page = this.page;
    const items = page.locator(SEL.convItem);
    const n = Math.min(await items.count(), limit);
    const out = [];
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      const name = (await it.locator(SEL.convItemName).first().textContent().catch(() => ""))?.trim() || "(unknown)";
      const snippet = (await it.locator(SEL.convItemSnippet).first().textContent().catch(() => ""))?.trim() || "";
      const unread = await it.locator(SEL.convItemUnread).first().isVisible().catch(() => false);
      out.push({ index: i, name, snippet, unread });
    }
    return out;
  }

  async _openConversationByName(name) {
    await this._requirePaired();
    const page = this.page;
    const item = page.locator(SEL.convItem, { hasText: name }).first();
    if (!(await item.count())) throw new Error(`No open conversation matching "${name}". Use send_message to start a new one.`);
    await item.click();
    await page.waitForTimeout(1200);
  }

  async readConversation(name, limit = 30) {
    await this._openConversationByName(name);
    const page = this.page;
    const msgs = page.locator(SEL.messageWrapper);
    const total = await msgs.count();
    const start = Math.max(0, total - limit);
    const out = [];
    for (let i = start; i < total; i++) {
      const m = msgs.nth(i);
      const text = (await m.locator(SEL.messageText).first().textContent().catch(() => ""))?.trim();
      if (!text) continue;
      // Outgoing is the wrapper's own `is-outgoing` attribute ("true"/"false").
      const outgoing = (await m.getAttribute("is-outgoing").catch(() => null)) === "true";
      out.push({ from: outgoing ? "me" : "them", text });
    }
    return out;
  }

  async sendMessage(to, text) {
    await this._requirePaired();
    const page = this.page;

    // Try an already-open conversation matching `to`; otherwise start a new chat.
    const existing = page.locator(SEL.convItem, { hasText: to }).first();
    if (await existing.count()) {
      await existing.click();
      await page.waitForTimeout(1000);
    } else {
      await page.locator(SEL.startChatButton).first().click();
      await page.waitForTimeout(1000);
      const recip = page.locator(SEL.recipientInput).first();
      await recip.fill(to);
      await page.waitForTimeout(1500);
      // Click the first matching contact, or press Enter for a raw phone number.
      const result = page.locator(SEL.recipientFirstResult).first();
      if (await result.count()) await result.click();
      else await recip.press("Enter");
      await page.waitForTimeout(1200);
    }

    const input = page.locator(SEL.composeInput).first();
    await input.click();
    await input.fill(text);
    const send = page.locator(SEL.sendButton).first();
    if (await send.isEnabled().catch(() => false)) await send.click();
    else await input.press("Enter");
    await page.waitForTimeout(1000);
    return { ok: true, to, text };
  }

  async search(query, limit = 20) {
    await this._requirePaired();
    const page = this.page;
    await page.locator(SEL.searchButton).first().click().catch(() => {});
    const input = page.locator(SEL.searchInput).first();
    await input.fill(query);
    await page.waitForTimeout(1800);
    const items = page.locator(SEL.convItem);
    const n = Math.min(await items.count(), limit);
    const out = [];
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      const name = (await it.locator(SEL.convItemName).first().textContent().catch(() => ""))?.trim() || "(unknown)";
      const snippet = (await it.locator(SEL.convItemSnippet).first().textContent().catch(() => ""))?.trim() || "";
      out.push({ name, snippet });
    }
    return out;
  }

  async debugSnapshot() {
    const page = await this.ensureReady();
    const url = page.url();
    const title = await page.title();
    const probe = {};
    for (const [k, v] of Object.entries(SEL)) {
      probe[k] = await page.locator(v).count().catch(() => -1);
    }
    return { url, title, selectorCounts: probe };
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
  }
}
