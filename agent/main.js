import "dotenv/config";
import { withMcpClient } from "./mcp_client.js";
import { findNewListings } from "./search.js";
import { loadSeenIds, saveSeenIds } from "./dedup.js";
import { sendDigest } from "./email_digest.js";

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function run() {
  const seenIds = await loadSeenIds();
  log(`Loaded ${seenIds.size} previously seen listing IDs.`);

  const { newListings, allIds } = await withMcpClient((client) =>
    findNewListings(client, seenIds)
  );

  log(`Search returned ${allIds.size} total matches; ${newListings.length} new.`);

  if (newListings.length > 0) {
    await sendDigest(newListings);
    log(`Sent digest email with ${newListings.length} listing(s).`);
  } else {
    log("No new listings — no email sent.");
  }

  const updatedSeenIds = new Set([...seenIds, ...allIds]);
  await saveSeenIds(updatedSeenIds);
  log(`State updated: ${updatedSeenIds.size} total seen listing IDs.`);
}

run().catch((err) => {
  // StreetEasy 403s (bot-detection) are expected occasionally; log and let
  // the next scheduled run retry rather than treating this as fatal.
  log(`Run failed, skipping this cycle: ${err.message}`);
});
