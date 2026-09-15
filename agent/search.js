import { callTool } from "./mcp_client.js";
import { FILTERS } from "./config.js";

/** Fetch every page of matching listings from search_rentals — the only API call per run. */
async function searchAllPages(client) {
  const listings = [];
  let page = 1;
  for (;;) {
    const data = await callTool(client, "search_rentals", { ...FILTERS, page });
    listings.push(...data.listings);
    if (listings.length >= data.totalCount || data.returned === 0) break;
    page += 1;
  }
  return listings;
}

/**
 * Returns { newListings, allIds } from a single search_rentals call.
 *
 * Deliberately doesn't call get_rental_details per listing (that used to
 * check for "virtual doorman" and washer/dryer, neither of which appear in
 * search results) — repeated per-listing calls in one run were the main
 * thing tripping StreetEasy's bot detection. The DOORMAN filter still
 * applies, but doesn't distinguish full-time from virtual doorman, so
 * results should be spot-checked on StreetEasy before ruling a building in
 * or out.
 */
export async function findNewListings(client, seenIds) {
  const listings = await searchAllPages(client);
  const allIds = new Set(listings.map((l) => l.id));
  const newListings = listings.filter((l) => !seenIds.has(l.id));
  return { newListings, allIds };
}
