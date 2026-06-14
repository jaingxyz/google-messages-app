# Google Messages — App + MCP

Google Messages for web ([messages.google.com/web](https://messages.google.com/web)) wrapped as a
persistent-session macOS app **and** an MCP server, so you can text from a desktop window *and* let
Claude send/read/search your messages.

## How it works (and the one big caveat)

Google Messages has **no official API**. The only desktop interface is the phone-paired web client, so
everything here drives that web page with [Playwright](https://playwright.dev). Practical consequences:

- ✅ Works for your own account and messages (personal automation).
- ⚠️ **Fragile to UI changes** — if Google changes the page HTML, selectors break. They live in one
  place: the `SEL` block in [`src/messages.mjs`](src/messages.mjs). Use the `debug_snapshot` tool to
  see what currently matches, then fix them.
- ⚠️ Your phone is still the SMS/RCS engine; the pairing expires after ~14 days of the phone being offline.

One **persistent Chromium profile** (in `~/Library/Application Support/google-messages-mcp/profile`)
holds your pairing, so you log in once. The same profile is both the app window and the automation target.

> The profile can only be opened by one process at a time. When the MCP server is running, its headed
> window *is* your app — don't also run `npm run app` simultaneously.

## Setup

```bash
npm install          # installs deps + the Chromium binary (postinstall)
```

### First run — pair your phone

```bash
npm run app
```

A window opens showing a QR code. On your phone: **Google Messages → menu → Device pairing → QR code
scanner**, scan it, and tick **“Remember this computer.”** The session now persists.

## Use as an MCP server

Point your MCP client at the server. Example Claude Code / Claude Desktop config —
replace `/ABSOLUTE/PATH/TO` with wherever you cloned this repo (run `pwd` in the repo root):

```json
{
  "mcpServers": {
    "google-messages": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/google-messages-app/src/server.mjs"]
    }
  }
}
```

> **Note:** the app must run with a visible window — the Messages web SPA crashes under
> headless Chromium, so there is no headless mode.

### Tools

| Tool | What it does |
|---|---|
| `pairing_status` | Check if the session is paired; call first if others fail |
| `list_conversations` | Recent threads (name, snippet, unread) |
| `read_conversation` | Recent messages in a thread (by name) |
| `send_message` | Send to a contact name or raw phone number |
| `search_messages` | Search threads for a query |
| `delete_conversation` | Move a thread to Trash (recoverable) by exact name; refuses on ambiguity |
| `debug_snapshot` | Maintenance: dump selector match counts when the UI changes |

## Maintenance

When a tool returns empty/odd results, run `debug_snapshot`. If selector counts are `0`, the UI changed —
update the matching entry in the `SEL` block of `src/messages.mjs`.

## License

[GNU AGPL-3.0-or-later](LICENSE). Note the network-use clause: if you run a modified version of this
software as a network service, you must make your modified source available to its users.
