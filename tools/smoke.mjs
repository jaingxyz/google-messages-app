// Read-only smoke test of the Messages class against the live paired session.
// Does NOT send anything.
import { Messages } from "../src/messages.mjs";

const m = new Messages({ headless: false });
try {
  console.log("pairing:", await m.pairingStatus());
  const convos = await m.listConversations(5);
  console.log("\nlist_conversations (5):", JSON.stringify(convos, null, 2));
  if (convos[0]) {
    const msgs = await m.readConversation(convos[0].name, 6);
    console.log(`\nread_conversation("${convos[0].name}", 6):`, JSON.stringify(msgs, null, 2));
  }
} catch (e) {
  console.error("SMOKE ERROR:", e.message);
} finally {
  await m.close();
}
