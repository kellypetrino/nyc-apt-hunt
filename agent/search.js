import { callTool } from "./mcp_client.js";
import { FILTERS, VIRTUAL_DOORMAN_PATTERN } from "./config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DETAIL_FETCH_DELAY_MS = 1500;

/** Fetch every page of matching listings from search_rentals. */
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
 * Enriches a listing with amenities.list + description via get_rental_details,
 * and flags virtual-doorman buildings for exclusion (StreetEasy's DOORMAN
 * amenity token doesn't distinguish full-time vs. virtual doorman).
 */
async function enrichListing(client, listing) {
  const details = await callTool(client, "get_rental_details", { listingId: listing.id });
  const rental = details.rentalByListingId;
  const amenities = rental?.propertyDetails?.amenities?.list || [];
  const description = rental?.description || "";
  return {
    ...listing,
    amenities,
    isVirtualDoorman: VIRTUAL_DOORMAN_PATTERN.test(description),
  };
}

/**
 * Returns { newListings, allSeenIds } — newListings are enriched and filtered
 * to exclude virtual-doorman buildings; allSeenIds is every matching listing
 * ID from this run (used to update dedup state, including virtual-doorman
 * ones so we don't keep re-fetching their details every run).
 */
export async function findNewListings(client, seenIds) {
  const listings = await searchAllPages(client);
  const allIds = new Set(listings.map((l) => l.id));
  const candidates = listings.filter((l) => !seenIds.has(l.id));

  // A detail request fired immediately after the search call (zero think-time)
  // doesn't look like normal browsing, so pace every detail fetch, including
  // the first.
  const enriched = [];
  for (const listing of candidates) {
    await sleep(DETAIL_FETCH_DELAY_MS);
    enriched.push(await enrichListing(client, listing));
  }

  const newListings = enriched.filter((l) => !l.isVirtualDoorman);
  return { newListings, allIds };
}
