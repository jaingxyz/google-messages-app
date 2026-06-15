# Google Messages — App + MCP

Google Messages for web ([messages.google.com/web](https://messages.google.com/web)) wrapped as a
persistent-session macOS app **and** an MCP server, so you can text from a desktop window _and_ let
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
> window _is_ your app — don't also run `npm run app` simultaneously.

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

> **Note:** The Messages web SPA has historically crashed or failed to render
> correctly under true headless Chromium. By default we run **headed** but make
> the window 100% invisible on macOS for automation (Garvis, MCP clients, etc.):
>
> - Launch args: `--window-position=-100000,-100000 --window-size=1,1` plus
>   common suppression flags (`--no-first-run`, `--disable-infobars`, etc.).
> - As soon as the browser context is created (and at 250ms + 700ms), AppleScript
>   forces: `visible of process = false`, window to off-screen + tiny size,
>   minimized, and not frontmost.
>
> This keeps your persistent paired session working while preventing any visible
> window or navigation during tool calls / Garvis sweeps.
>
> You can still force experimental true headless with `GM_HEADLESS=true` (or `1`
> or `new`) if you want to try, but success is not guaranteed.
>
> Profile lock handling still applies (only one client can hold the profile).
> For Garvis the pkill + sleep logic is only active when not using the hidden-headed
> path.

### Tools

| Tool                  | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `pairing_status`      | Check if the session is paired; call first if others fail                |
| `list_conversations`  | Recent threads (name, snippet, unread)                                   |
| `read_conversation`   | Recent messages in a thread (by name)                                    |
| `send_message`        | Send to a contact name or raw phone number                               |
| `search_messages`     | Search threads for a query                                               |
| `delete_conversation` | Move a thread to Trash (recoverable) by exact name; refuses on ambiguity |
| `debug_snapshot`      | Maintenance: dump selector match counts when the UI changes              |

## Maintenance

When a tool returns empty/odd results, run `debug_snapshot`. If selector counts are `0`, the UI changed —
update the matching entry in the `SEL` block of `src/messages.mjs`.

## License

[GNU AGPL-3.0-or-later](LICENSE). Note the network-use clause: if you run a modified version of this
software as a network service, you must make your modified source available to its users.
