#!/usr/bin/env node
// Standalone app launcher: opens the same persistent-profile Chromium as a plain
// window so you can use Google Messages like a desktop app (and pair the first time).
//
// NOTE: the Chromium profile can only be opened by one process at a time. Don't run
// this at the same time as the MCP server — when the MCP server is running, ITS
// headed window already is your app.

import { Messages } from "./messages.mjs";

const messages = new Messages({ headless: false });
await messages.ensureReady();
const status = await messages.pairingStatus();
console.error(status.message);
console.error("App window is open. Leave it running. Close the window or press Ctrl+C to quit.");

// Keep the process alive until the window/context closes.
process.stdin.resume();
process.on("SIGINT", async () => { await messages.close(); process.exit(0); });
