import { test } from "node:test";
import assert from "node:assert/strict";
import { Messages } from "../src/messages.mjs";

// No browser is launched: constructing Messages is lazy, and the DOM-facing
// private helpers are stubbed per test.
const stub = (overrides) => Object.assign(new Messages(), overrides);

test("constructor does not launch a browser", () => {
  const m = new Messages({ headless: true });
  assert.equal(m.context, null);
  assert.equal(m.page, null);
  assert.equal(m.headless, true);
});

test("public calls are serialized and survive a failing call", async () => {
  const order = [];
  const m = new Messages();
  const slow = m._serialize(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push("slow");
  });
  const boom = m._serialize(async () => {
    order.push("boom");
    throw new Error("boom");
  });
  const fast = m._serialize(async () => order.push("fast"));
  await slow;
  await assert.rejects(boom, /boom/);
  await fast;
  assert.deepEqual(order, ["slow", "boom", "fast"]);
});

test("search matches name or snippet, case-insensitively, and respects limit", async () => {
  const m = stub({
    _requirePaired: async () => {},
    _extractItems: async () => [
      { name: "Alice", snippet: "see you" },
      { name: "Bob", snippet: "ask ALICE" },
      { name: "Carol", snippet: "nothing" },
    ],
  });
  assert.deepEqual(
    (await m.search("alice", 10)).map((c) => c.name),
    ["Alice", "Bob"],
  );
  assert.equal((await m.search("alice", 1)).length, 1);
  assert.deepEqual(await m.search("   ", 10), []);
});

function listStub(pages) {
  let i = 0;
  return stub({
    _scrollListTo: async () => {},
    _snapshotLoaded: async () => pages[Math.min(i, pages.length - 1)],
    _scrollListBy: async () => ++i < pages.length,
  });
}

test("_findConversation matches exact names across scroll pages", async () => {
  const m = listStub([[{ id: "/1", name: "Alice Smith" }], [{ id: "/2", name: "alice" }]]);
  assert.equal(await m._findConversation("  Alice "), "/2");
});

test("_findConversation refuses ambiguous exact matches", async () => {
  const m = listStub([
    [
      { id: "/1", name: "Mom" },
      { id: "/2", name: "mom" },
    ],
  ]);
  await assert.rejects(m._findConversation("MOM"), /matches multiple/);
});

test("_findConversation returns null once the list is exhausted", async () => {
  const m = listStub([[{ id: "/1", name: "Alice" }]]);
  assert.equal(await m._findConversation("Zed"), null);
});
