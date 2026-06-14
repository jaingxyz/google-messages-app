// CLI helper: move a conversation to Trash by exact name.
// Usage: node tools/delete.mjs "<exact conversation name>"
import { Messages } from "../src/messages.mjs";

const name = process.argv[2];
if (!name) {
  console.error('usage: node tools/delete.mjs "<exact conversation name>"');
  process.exit(1);
}

const m = new Messages({ headless: false });
try {
  const result = await m.deleteConversation(name);
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await m.close();
}
