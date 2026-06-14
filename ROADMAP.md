# Roadmap & Feasibility Notes

Exploratory notes on two possible directions. Nothing here is built yet — these are
feasibility musings, captured for later.

## 1. A WhatsApp equivalent

**Technically straightforward.** WhatsApp Web (`web.whatsapp.com`) is a QR-paired web
client just like Google Messages, so the same architecture (Playwright + a persistent
profile, headed) transfers almost directly. The work would be rewriting the `SEL`
selector block and the per-action flows in `src/messages.mjs` against WhatsApp's DOM.

**The risk profile is materially worse, though:**

- **Ban risk.** WhatsApp's ToS explicitly prohibit unofficial automation, and Meta
  actively detects and bans accounts for it — especially automated *sending*. Reading
  is lower-risk; sending is where people lose their number. (Google Messages is far
  more lenient by comparison.)
- **Sanctioned path = WhatsApp Business Cloud API** (Meta's official API). The
  legitimate way to automate, but built for businesses: Business account, registered
  number, template-message rules. Not designed for automating a *personal* number.
- Reverse-engineered libraries (`whatsapp-web.js`, `Baileys`) exist and are popular,
  but carry the same ToS/ban exposure as a Playwright wrapper.

**Verdict:** fine for personal, low-volume, read-mostly use if you accept ban risk on
that number. For a number you can't lose, use the Business API instead.

## 2. Deploying to the cloud (AWS) for always-on automation

**Feasible, but this is a stateful browser tied to a phone — not a normal stateless
service.** Requirements:

1. **Virtual display.** The Messages SPA crashes truly-headless, so on a headless
   Linux box run "headed" Chromium under **Xvfb** (virtual framebuffer).
2. **One-time QR pairing on a remote box** — via VNC, or screenshot the QR and scan
   it. Re-needed only if the phone goes offline >~14 days (Messages web pairing expiry).
3. **Phone stays online.** Messages web relays through the phone; the cloud box and the
   phone both need internet.
4. **Persistent disk** for the profile (paired session). Easiest on **EC2 + EBS**;
   harder on Fargate (ephemeral). A small `t3.small` (~$15/mo) running Chromium under
   Xvfb + automation on cron/systemd is the simplest shape.
5. **Drop the stdio MCP layer for cloud.** The MCP stdio server is for a local Claude
   client. For unattended automation, call the logic directly — the `Messages` class is
   already cleanly separated, so cron jobs (or the `tools/*.mjs` scripts) can call
   `sendMessage` / `listConversations` / etc. without MCP. Could also wrap it in a small
   HTTP service for remote triggering.

**Security caveat:** a paired session on a cloud box means anyone who breaches that box
can read and send your texts. Lock it down — private subnet, key-only SSH, encrypted
EBS, no public ingress.

**Note:** this can't run on Anthropic's cloud routines (ephemeral sessions, unsuitable
for a persistent paired browser). AWS self-hosting is the route.

**Rough scope:** a weekend project — Dockerfile (Chromium + Xvfb), EC2 + EBS, a pairing
runbook, and cron for the automations. Recommended order: get Messages running in the
cloud first, then consider the WhatsApp variant.
