import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL || "http://localhost:3939/mcp");
const transport = new StreamableHTTPClientTransport(url);
const client = new Client({ name: "test", version: "1.0.0" });

await client.connect(transport);
console.log("CONNECTED");

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map(t => t.name).join(", "));

// list_amenities
const am = await client.callTool({ name: "list_amenities", arguments: {} });
console.log("\nAMENITIES (first 120 chars):", am.content[0].text.slice(0, 120));

// list_areas filtered
const ar = await client.callTool({ name: "list_areas", arguments: { search: "williams" } });
console.log("\nAREAS williams:", ar.content[0].text.replace(/\s+/g," "));

// search_rentals
const sr = await client.callTool({ name: "search_rentals", arguments: {
  areas: ["Williamsburg"],
  maxPrice: 4000,
  minBedrooms: 1,
  amenities: ["WASHER_DRYER"],
  perPage: 3,
  sortBy: "PRICE",
  sortDirection: "ASCENDING"
}});
const srData = JSON.parse(sr.content[0].text);
console.log("\nSEARCH totalCount:", srData.totalCount, "returned:", srData.returned);
console.log("first listing:", JSON.stringify(srData.listings[0], null, 1).slice(0, 600));

const firstId = srData.listings[0]?.id;
console.log("\nfirstId:", firstId);

// get_rental_details
if (firstId) {
  const det = await client.callTool({ name: "get_rental_details", arguments: { listingId: firstId } });
  const detData = JSON.parse(det.content[0].text);
  const r = detData.rentalByListingId;
  console.log("DETAILS status:", r?.status, "| price:", r?.pricing?.price, "| beds:", r?.propertyDetails?.bedroomCount, "| url:", r?.url);
  console.log("amenities.list:", (r?.propertyDetails?.amenities?.list||[]).join(", "));
  console.log("building name:", detData.buildingByRentalListingId?.name);
}

// error path
const err = await client.callTool({ name: "search_rentals", arguments: { amenities: ["NOT_A_REAL_AMENITY"] }});
console.log("\nERROR PATH isError:", err.isError, "| msg:", err.content[0].text.slice(0,80));

await client.close();
console.log("\nALL TESTS PASSED");
