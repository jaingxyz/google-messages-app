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

// Not named `URL` — that would shadow the global WHATWG URL constructor.
const CONVERSATIONS_URL = "https://messages.google.com/web/conversations";

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
  // The inner <a> carries a stable conversation id in its href — used to dedup across
  // scroll steps (the list recycles DOM nodes, so the same thread reappears).
  convItemLink: "a.list-item, a[href*='/web/conversations/']",
  convItemName: "[data-e2e-conversation-name], h2.name, .name",
  convItemSnippet: "mws-conversation-snippet, .snippet-text, .snippet",
  convItemUnread: "[data-e2e-is-unread='true']",
  // Open thread: message bubbles. Outgoing is the wrapper's `is-outgoing` attribute.
  messageWrapper: "mws-message-wrapper",
  // One entry per text part. `.text-msg` is nested INSIDE the part, so it's only a
  // fallback — never OR them together or each message gets counted twice.
  messagePart: "mws-text-message-part",
  messageTextFallback: ".text-msg",
  // Compose box + send
  composeInput: "textarea[data-e2e-message-input-box], textarea[aria-label*='message' i]",
  sendButton: "mws-message-send-button button, button[aria-label*='Send' i]",
  // New conversation flow (recipientInput's last fallback is broad — keep specific ones first)
  startChatButton:
    "mw-fab-link a, a[href*='conversations/new'], button[aria-label*='Start chat' i]",
  recipientInput:
    "input[aria-label*='recipient' i], input[aria-label*='name, phone' i], input[type='text']",
  recipientFirstResult: "mw-contact-selector-result, [data-e2e-contact-result], .contact-row",
  // (Messages web has no built-in search UI, so search is done client-side
  // over the conversation list — see _search.)
  // Delete flow: per-row Options button → menu → "Move to trash" (recoverable).
  convOptionsButton: "button[aria-label^='Options for' i]",
  menuItem: "[role='menuitem'], button.mat-mdc-menu-item",
  // Some versions show a confirm dialog; click its affirmative button if present.
  confirmTrashButton: "mat-dialog-container button, [role='dialog'] button",
};

export class Messages {
  constructor({ headless = false } = {}) {
    this.headless = headless;
    this.context = null;
    this.page = null;
    // Serializes all public operations so concurrent tool calls can't interleave
    // navigation/clicks on the single shared page.
    this._lock = Promise.resolve();
  }

  _serialize(fn) {
    const run = this._lock.then(() => fn());
    this._lock = run.catch(() => {}); // keep the chain alive even if `fn` throws
    return run;
  }

  // --- public API (each call is serialized) -------------------------------
  pairingStatus() {
    return this._serialize(() => this._pairingStatus());
  }
  listConversations(limit = 20) {
    return this._serialize(() => this._listConversations(limit));
  }
  readConversation(name, limit = 30) {
    return this._serialize(() => this._readConversation(name, limit));
  }
  sendMessage(to, text) {
    return this._serialize(() => this._sendMessage(to, text));
  }
  search(query, limit = 20) {
    return this._serialize(() => this._search(query, limit));
  }
  deleteConversation(name) {
    return this._serialize(() => this._deleteConversation(name));
  }
  debugSnapshot() {
    return this._serialize(() => this._debugSnapshot());
  }
  close() {
    return this._serialize(() => this._close());
  }

  // --- browser lifecycle (unlocked: idempotent, also called by app.mjs) ----
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
    await this.page.goto(CONVERSATIONS_URL, { waitUntil: "domcontentloaded" });
    // Wait until the SPA renders EITHER the conversation list items (paired) or the
    // QR screen (not paired) — the list loads behind a spinner, so a fixed delay isn't enough.
    await Promise.race([
      this.page.waitForSelector(SEL.convItem, { timeout: 25000 }).catch(() => {}),
      this.page.waitForSelector(SEL.qr, { timeout: 25000 }).catch(() => {}),
    ]);
    return this.page;
  }

  // --- internal workers (NOT locked — public wrappers above hold the lock) -
  async _pairingStatus() {
    const page = await this.ensureReady();
    const paired =
      (await page
        .locator(SEL.convItem)
        .count()
        .catch(() => 0)) > 0;
    if (paired) return { paired: true, message: "Paired — Messages session is active." };
    const qr = await page
      .locator(SEL.qr)
      .first()
      .isVisible()
      .catch(() => false);
    if (qr) {
      return {
        paired: false,
        message:
          "NOT paired. A QR code is showing in the app window. On your phone: " +
          "Google Messages → Profile/menu → Device pairing → QR code scanner → scan it, " +
          "and tick 'Remember this computer'.",
      };
    }
    return {
      paired: false,
      message: "Could not determine pairing state — open the app window to check.",
    };
  }

  async _requirePaired() {
    const s = await this._pairingStatus();
    if (!s.paired) throw new Error(s.message);
  }

  // --- conversation-list scrolling ----------------------------------------
  // The list lazy-loads AND recycles DOM nodes: only a window of threads is mounted at
  // once, and scrolling reveals older ones (dropping ones that scroll out of view). So
  // to see the whole list we scroll incrementally and accumulate snapshots, keyed by the
  // stable conversation id, rather than trusting whatever happens to be mounted now.

  async _scrollListTo(pos) {
    await this.page.evaluate((pos) => {
      let el = document.querySelector("mws-conversation-list-item");
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 5) {
          el.scrollTop = pos;
          return;
        }
        el = el.parentElement;
      }
    }, pos);
    await this.page.waitForTimeout(400);
  }

  // Scroll the list down by ~80% of a viewport. Returns whether it actually moved
  // (false ⇒ we're at the bottom).
  async _scrollListBy() {
    const moved = await this.page.evaluate(() => {
      let el = document.querySelector("mws-conversation-list-item");
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 5) {
          const before = el.scrollTop;
          el.scrollTop = Math.min(
            el.scrollHeight,
            el.scrollTop + Math.floor(el.clientHeight * 0.8),
          );
          return el.scrollTop > before;
        }
        el = el.parentElement;
      }
      return false;
    });
    await this.page.waitForTimeout(600);
    return moved;
  }

  // Snapshot the currently-mounted conversation rows in DOM order.
  async _snapshotLoaded() {
    return this.page.$$eval(
      SEL.convItem,
      (items, sels) =>
        items.map((it) => {
          const link = it.querySelector(sels.link);
          const name = (it.querySelector(sels.name)?.textContent || "").trim();
          return {
            id: link?.getAttribute("href") || name,
            name,
            snippet: (it.querySelector(sels.snip)?.textContent || "").trim(),
            unread: !!it.querySelector(sels.unread),
          };
        }),
      {
        link: SEL.convItemLink,
        name: SEL.convItemName,
        snip: SEL.convItemSnippet,
        unread: SEL.convItemUnread,
      },
    );
  }

  // Scroll from the top, accumulating unique conversations (by id) in order, until we
  // have `limit` or reach the bottom.
  async _collectConversations(limit, withMeta) {
    await this._scrollListTo(0);
    const map = new Map();
    let stagnant = 0;
    for (let pass = 0; pass < 80 && map.size < limit; pass++) {
      const before = map.size;
      for (const it of await this._snapshotLoaded()) if (!map.has(it.id)) map.set(it.id, it);
      const moved = await this._scrollListBy();
      if (map.size === before) stagnant += 1;
      else stagnant = 0;
      if (!moved || stagnant >= 2) break; // reached bottom / nothing new
    }
    return [...map.values()]
      .slice(0, limit)
      .map((c, index) =>
        withMeta
          ? { index, name: c.name, snippet: c.snippet, unread: c.unread }
          : { name: c.name, snippet: c.snippet },
      );
  }

  // Find a conversation by EXACT (case-insensitive) name, scrolling to reach older
  // threads. Compares only the name element (not snippet/timestamp) so it can't pick the
  // wrong thread. Returns the stable conversation id (href) or null — callers resolve it
  // with _locatorById, which is robust to the list reordering between find and action.
  //
  // Note: ambiguity is only detected within a single scroll window; two threads with the
  // identical display name far apart in the list won't be flagged (rare for exact names).
  async _findConversation(name) {
    const target = name.trim().toLowerCase();
    await this._scrollListTo(0);
    const seen = new Set();
    for (let pass = 0; pass < 80; pass++) {
      const batch = await this._snapshotLoaded();
      const winMatches = batch.filter((b) => b.name.toLowerCase() === target);
      if (winMatches.length > 1) {
        throw new Error(`"${name}" matches multiple conversations exactly — be more specific.`);
      }
      if (winMatches.length === 1) return winMatches[0].id;
      const before = seen.size;
      for (const b of batch) seen.add(b.id);
      const grew = seen.size > before;
      const moved = await this._scrollListBy();
      if (!moved && !grew) return null; // bottom + nothing new → exhausted
    }
    return null;
  }

  // Resolve a conversation id (href) to a stable locator — matches by id, not position,
  // so it stays correct even if the list reorders after the row was found.
  _locatorById(id) {
    // NB: use a single `a[href=...]` here — do NOT interpolate SEL.convItemLink, which is
    // a comma-list and would turn `:has(...)` into a match-any-row predicate.
    if (id && id.startsWith("/")) {
      return this.page.locator(`${SEL.convItem}:has(a[href="${id}"])`).first();
    }
    // Fallback (no href was available): match by name text.
    return this.page.locator(SEL.convItem, { hasText: id }).first();
  }

  async _extractItems(limit, withMeta) {
    return this._collectConversations(limit, withMeta);
  }

  async _listConversations(limit) {
    await this._requirePaired();
    return this._extractItems(limit, true);
  }

  async _openConversationByName(name) {
    await this._requirePaired();
    const id = await this._findConversation(name);
    if (!id)
      throw new Error(`No open conversation named "${name}". Use send_message to start a new one.`);
    await this._locatorById(id).click();
    await this.page.waitForTimeout(1200);
  }

  async _readConversation(name, limit) {
    await this._openConversationByName(name);
    const msgs = this.page.locator(SEL.messageWrapper);
    const total = await msgs.count();
    const start = Math.max(0, total - limit);
    const out = [];
    for (let i = start; i < total; i++) {
      const m = msgs.nth(i);
      // A wrapper can hold multiple text parts — join them so nothing is dropped.
      let parts = await m
        .locator(SEL.messagePart)
        .allTextContents()
        .catch(() => []);
      if (!parts.length)
        parts = await m
          .locator(SEL.messageTextFallback)
          .allTextContents()
          .catch(() => []);
      parts = parts.map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      // Outgoing is the wrapper's own `is-outgoing` attribute ("true"/"false").
      const outgoing = (await m.getAttribute("is-outgoing").catch(() => null)) === "true";
      out.push({ from: outgoing ? "me" : "them", text: parts.join("\n") });
    }
    return out;
  }

  async _sendMessage(to, text) {
    await this._requirePaired();
    const page = this.page;

    // Open an existing thread only on an EXACT name match; otherwise start a new chat.
    const existingId = await this._findConversation(to);
    if (existingId) {
      await this._locatorById(existingId).click();
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
    // There can be multiple send buttons (e.g. a hidden inline one) — click the first
    // VISIBLE + enabled one; fall back to Enter (which sends in Messages web).
    const sendButtons = page.locator(SEL.sendButton);
    const sendCount = await sendButtons.count();
    let clicked = false;
    for (let i = 0; i < sendCount; i++) {
      const b = sendButtons.nth(i);
      if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) {
        await b.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) await input.press("Enter");
    await page.waitForTimeout(1200);

    // Confirm the send: a successful send clears the compose box. If the text is
    // still there, the message was NOT sent (disabled send, unresolved recipient, etc.).
    const remaining = (await input.inputValue().catch(() => ""))?.trim();
    if (remaining) {
      throw new Error(
        "Send not confirmed — the text is still in the compose box, so the message may not have been sent.",
      );
    }
    return { ok: true, to, text };
  }

  // Messages web has no search UI, so we filter the loaded conversation list
  // client-side by name and last-message snippet (case-insensitive substring).
  async _search(query, limit) {
    await this._requirePaired();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = await this._extractItems(200, false);
    return all
      .filter((c) => c.name.toLowerCase().includes(q) || c.snippet.toLowerCase().includes(q))
      .slice(0, limit);
  }

  // Move a conversation to Trash (recoverable). Uses EXACT name matching and refuses
  // on ambiguity (via _findConversation) so it can never trash the wrong thread.
  async _deleteConversation(name) {
    await this._requirePaired();
    const page = this.page;
    const id = await this._findConversation(name);
    if (!id) throw new Error(`No conversation named "${name}" to delete.`);
    const item = this._locatorById(id);

    await item.hover();
    await page.waitForTimeout(300);
    await item.locator(SEL.convOptionsButton).first().click();
    await page.waitForTimeout(600);

    const trash = page.locator(SEL.menuItem, { hasText: /move to trash/i }).first();
    if (!(await trash.count())) {
      await page.keyboard.press("Escape").catch(() => {});
      throw new Error("Could not find the 'Move to trash' option — the menu UI may have changed.");
    }
    await trash.click();
    await page.waitForTimeout(800);

    // Some versions show a confirmation dialog — confirm only an affirmative button.
    const confirm = page
      .locator(SEL.confirmTrashButton, { hasText: /trash|delete|confirm|ok/i })
      .first();
    if ((await confirm.count()) && (await confirm.isVisible().catch(() => false))) {
      await confirm.click();
      await page.waitForTimeout(800);
    }

    // Verify it's gone — poll the current window for the trashed id (cheap: no re-scroll,
    // since the row was on-screen and trashing removes it in place).
    let gone = false;
    for (let attempt = 0; attempt < 8 && !gone; attempt++) {
      await page.waitForTimeout(400);
      const ids = (await this._snapshotLoaded()).map((b) => b.id);
      gone = !ids.includes(id);
    }
    if (!gone) {
      throw new Error(
        `Tried to trash "${name}" but it's still in the list — it may not have been removed.`,
      );
    }
    return {
      ok: true,
      trashed: name,
      note: "Moved to Trash — recoverable from the Messages Trash folder.",
    };
  }

  async _debugSnapshot() {
    const page = await this.ensureReady();
    const url = page.url();
    const title = await page.title();
    const probe = {};
    for (const [k, v] of Object.entries(SEL)) {
      probe[k] = await page
        .locator(v)
        .count()
        .catch(() => -1);
    }
    return { url, title, selectorCounts: probe };
  }

  async _close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
  }
}
