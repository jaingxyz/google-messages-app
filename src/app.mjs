#!/usr/bin/env node
// Standalone app launcher: opens the same persistent-profile Chromium as a plain
// window so you can use Google Messages like a desktop app (and pair the first time).
//
// NOTE: the Chromium profile can only be opened by one process at a time. Don't run
// this at the same time as the MCP server — when the MCP server is running, ITS
// headed window already is your app.

import { Messages } from "./messages.mjs";

// The standalone app is normally headed (visible window). You can still force
// experimental headless with GM_HEADLESS=true for testing, but you won't see
// anything and the SPA may not work.
const headlessEnv = process.env.GM_HEADLESS || process.env.HEADLESS || "";
const headless =
  headlessEnv === "true" || headlessEnv === "1" ? true : headlessEnv === "new" ? "new" : false;

const messages = new Messages({ headless });
await messages.ensureReady();
const status = await messages.pairingStatus();
console.error(status.message);
console.error("App window is open. Leave it running. Close the window or press Ctrl+C to quit.");

// Keep the process alive until the window/context closes.
process.stdin.resume();
process.on("SIGINT", async () => {
  await messages.close();
  process.exit(0);
});
