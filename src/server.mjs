#!/usr/bin/env node
// MCP server exposing Google Messages tools. Communicates over stdio, so NOTHING
// may be written to stdout except the MCP protocol — all logging uses stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Messages } from "./messages.mjs";

// Always headed — the same window doubles as your "app", and the Messages web
// SPA crashes under headless Chromium, so there is no headless mode.
const messages = new Messages({ headless: false });

const server = new McpServer({ name: "google-messages", version: "1.0.0" });

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message || e}` }], isError: true });

server.tool(
  "pairing_status",
  "Check whether the Google Messages web session is paired with your phone. Call this first if other tools fail.",
  {},
  async () => {
    try { return text(await messages.pairingStatus()); } catch (e) { return fail(e); }
  }
);

server.tool(
  "list_conversations",
  "List recent conversation threads (name, last-message snippet, unread flag).",
  { limit: z.number().int().min(1).max(50).default(20).describe("Max threads to return") },
  async ({ limit }) => {
    try { return text(await messages.listConversations(limit)); } catch (e) { return fail(e); }
  }
);

server.tool(
  "read_conversation",
  "Read recent messages in a conversation, identified by its EXACT thread name (as shown in list_conversations).",
  {
    name: z.string().describe("Exact conversation name from list_conversations (case-insensitive)"),
    limit: z.number().int().min(1).max(100).default(30).describe("Max messages to return"),
  },
  async ({ name, limit }) => {
    try { return text(await messages.readConversation(name, limit)); } catch (e) { return fail(e); }
  }
);

server.tool(
  "send_message",
  "Send an SMS/RCS message. `to` is matched against existing threads by EXACT name; if none matches it starts a new chat (use a phone number for new recipients). Returns an error if the send can't be confirmed.",
  {
    to: z.string().describe("Exact existing thread name, or a phone number for a new chat"),
    text: z.string().describe("Message body"),
  },
  async ({ to, text: body }) => {
    try { return text(await messages.sendMessage(to, body)); } catch (e) { return fail(e); }
  }
);

server.tool(
  "search_messages",
  "Search conversations for a query string; returns matching threads.",
  {
    query: z.string().describe("Text to search for"),
    limit: z.number().int().min(1).max(50).default(20),
  },
  async ({ query, limit }) => {
    try { return text(await messages.search(query, limit)); } catch (e) { return fail(e); }
  }
);

server.tool(
  "delete_conversation",
  "Move a conversation to Trash (recoverable from the Messages Trash folder), matched by its EXACT name. Refuses on ambiguity. Destructive — only call with clear user intent.",
  { name: z.string().describe("Exact conversation name from list_conversations (case-insensitive)") },
  async ({ name }) => {
    try { return text(await messages.deleteConversation(name)); } catch (e) { return fail(e); }
  }
);

server.tool(
  "debug_snapshot",
  "Maintenance: dump the live page URL/title and how many elements each selector matches. Use this to fix selectors when the UI changes.",
  {},
  async () => {
    try { return text(await messages.debugSnapshot()); } catch (e) { return fail(e); }
  }
);

process.on("SIGINT", async () => { await messages.close(); process.exit(0); });
process.on("SIGTERM", async () => { await messages.close(); process.exit(0); });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[google-messages-mcp] server ready on stdio");
