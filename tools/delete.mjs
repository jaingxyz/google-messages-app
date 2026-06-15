// CLI helper: move a conversation to Trash by exact name.
// Usage: node tools/delete.mjs "<exact conversation name>"
import { Messages } from "../src/messages.mjs";

const name = process.argv[2];
if (!name) {
  console.error('usage: node tools/delete.mjs "<exact conversation name>"');
  process.exit(1);
}

// Respect GM_HEADLESS for testing the experimental headless path.
const headlessEnv = process.env.GM_HEADLESS || process.env.HEADLESS || "";
const headless =
  headlessEnv === "true" || headlessEnv === "1" ? true : headlessEnv === "new" ? "new" : false;
const m = new Messages({ headless });
try {
  const result = await m.deleteConversation(name);
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await m.close();
}
