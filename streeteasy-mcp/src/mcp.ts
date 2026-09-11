import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StreetEasyClient } from "./streeteasy/index";
import { Amenities } from "./streeteasy/constants";
import type {
  SearchFilters,
  SearchRentalsInput,
  SortingAttribute,
  SortingDirection,
} from "./streeteasy/types";
import { resolveAreaCode, listAreas } from "./areas";
import {
  normalizeSearch,
  stripTypename,
  listingUrl,
  photoUrls,
  videoLinks,
} from "./listings";

const VALID_AMENITIES = new Set<string>(Object.values(Amenities));

/**
 * Thin wrapper around McpServer.registerTool that erases the deep generic
 * inference (zod raw shapes with many optional fields otherwise trigger
 * TS2589 "type instantiation is excessively deep"). Handlers type their own
 * args, which we validate at runtime anyway.
 */
function registerTool(
  server: McpServer,
  name: string,
  config: { title: string; description: string; inputSchema: z.ZodRawShape },
  handler: (args: any) => any,
): void {
  (server.registerTool as any)(name, config, handler);
}

function jsonContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorContent(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * Build a fresh McpServer with all StreetEasy tools registered. A new instance
 * is created per request in the stateless transport.
 */
export function buildServer(): McpServer {
  const client = new StreetEasyClient();

  const server = new McpServer(
    { name: "streeteasy-mcp", version: "0.1.0" },
    {
      instructions:
        "Tools for searching NYC rental listings on StreetEasy and fetching full " +
        "listing details. Use list_areas / list_amenities to discover valid filter " +
        "values, search_rentals to find listings, and get_rental_details for a deep " +
        "dive on a specific listing id returned by search.",
    },
  );

  registerTool(
    server,
    "search_rentals",
    {
      title: "Search StreetEasy rentals",
      description:
        "Search active NYC rental listings on StreetEasy with filters. " +
        "Areas accept names (e.g. 'MANHATTAN', 'Williamsburg', 'upper east side') " +
        "or numeric area codes — use list_areas to discover them. Amenities are " +
        "uppercase enum tokens — use list_amenities. Returns a compact list of " +
        "listings plus a totalCount; paginate with page/perPage. Each listing has " +
        "an `id` you can pass to get_rental_details, plus `leadPhotoUrl` and " +
        "`photoUrls` (ready-to-view image URLs) and a `url` to the listing page.",
      inputSchema: {
        areas: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Neighborhoods/boroughs to search. Names or numeric codes. E.g. ['MANHATTAN'] or ['WILLIAMSBURG','LONG_ISLAND_CITY'].",
          ),
        minPrice: z.number().optional().describe("Minimum monthly rent in USD."),
        maxPrice: z.number().optional().describe("Maximum monthly rent in USD."),
        minBedrooms: z
          .number()
          .optional()
          .describe("Minimum bedrooms (0 = studio)."),
        maxBedrooms: z.number().optional().describe("Maximum bedrooms."),
        minBathrooms: z.number().optional().describe("Minimum bathrooms."),
        maxBathrooms: z.number().optional().describe("Maximum bathrooms."),
        amenities: z
          .array(z.string())
          .optional()
          .describe(
            "Required amenities (uppercase enum tokens, e.g. WASHER_DRYER, DOORMAN, GYM). See list_amenities.",
          ),
        petsAllowed: z
          .boolean()
          .optional()
          .describe("Only listings that allow pets."),
        noFeeOnly: z
          .boolean()
          .optional()
          .describe("Only no-broker-fee listings (applied to the returned page)."),
        sortBy: z
          .enum(["RECOMMENDED", "LISTED_AT", "PRICE", "SQFT"])
          .optional()
          .describe("Sort attribute. Default RECOMMENDED."),
        sortDirection: z
          .enum(["ASCENDING", "DESCENDING"])
          .optional()
          .describe("Sort direction. Default DESCENDING."),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (default 20, max 100)."),
        page: z.number().int().min(1).optional().describe("Page number (1-based)."),
      },
    },
    async (args: SearchRentalsArgs) => {
      try {
        const filters: SearchFilters = { rentalStatus: "ACTIVE" };

        if (args.areas && args.areas.length > 0) {
          filters.areas = args.areas.map((a) =>
            resolveAreaCode(a),
          ) as SearchFilters["areas"];
        }
        if (args.minPrice !== undefined || args.maxPrice !== undefined) {
          filters.price = {
            lowerBound: args.minPrice ?? null,
            upperBound: args.maxPrice ?? null,
          };
        }
        if (args.minBedrooms !== undefined || args.maxBedrooms !== undefined) {
          filters.bedrooms = {
            lowerBound: args.minBedrooms ?? null,
            upperBound: args.maxBedrooms ?? null,
          };
        }
        if (args.minBathrooms !== undefined || args.maxBathrooms !== undefined) {
          filters.bathrooms = {
            lowerBound: args.minBathrooms ?? null,
            upperBound: args.maxBathrooms ?? null,
          };
        }
        if (args.amenities && args.amenities.length > 0) {
          const normalized = args.amenities.map((a) => a.toUpperCase().trim());
          const invalid = normalized.filter((a) => !VALID_AMENITIES.has(a));
          if (invalid.length > 0) {
            return errorContent(
              `Invalid amenities: ${invalid.join(", ")}. Use list_amenities to see valid values.`,
            );
          }
          filters.amenities = normalized as SearchFilters["amenities"];
        }
        if (args.petsAllowed !== undefined) filters.petsAllowed = args.petsAllowed;

        const perPage = args.perPage ?? 20;
        const page = args.page ?? 1;

        const input: SearchRentalsInput = {
          filters,
          perPage,
          page,
          sorting: {
            attribute: (args.sortBy ?? "RECOMMENDED") as SortingAttribute,
            direction: (args.sortDirection ?? "DESCENDING") as SortingDirection,
          },
        };

        const res = await client.searchRentals(input);
        const normalized = normalizeSearch(res, {
          page,
          perPage,
          noFeeOnly: args.noFeeOnly,
        });
        return jsonContent(normalized);
      } catch (err) {
        return errorContent(
          `search_rentals failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  registerTool(
    server,
    "get_rental_details",
    {
      title: "Get StreetEasy rental details",
      description:
        "Fetch full details for a single rental listing by its id (the `id` field " +
        "from search_rentals results). Returns description, full amenities/features, " +
        "pricing history, building info, nearby transit & schools, and media: " +
        "`media.photoUrls` and `media.floorPlanUrls` (CDN image URLs), " +
        "`media.videoLinks` (YouTube/Vimeo watch URLs + thumbnails), and " +
        "`media.tour3dUrl` (3D walkthrough) when available.",
      inputSchema: {
        listingId: z
          .string()
          .describe("The StreetEasy rental listing id, e.g. '5072403'."),
      },
    },
    async (args: { listingId: string }) => {
      try {
        const res = await client.getRentalListingDetails(args.listingId);
        const cleaned = stripTypename(res) as Record<string, any>;
        const rental = cleaned.rentalByListingId;
        if (rental) {
          rental.url = listingUrl(undefined, args.listingId);
          // Resolve media keys to usable URLs (photos via CDN, videos to watch links).
          if (rental.media) {
            rental.media.photoUrls = photoUrls(rental.media.photos);
            rental.media.floorPlanUrls = photoUrls(rental.media.floorPlans);
            rental.media.videoLinks = videoLinks(rental.media.videos);
            // tour3dUrl is already a usable link when present.
          }
        }
        return jsonContent(cleaned);
      } catch (err) {
        return errorContent(
          `get_rental_details failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  registerTool(
    server,
    "list_areas",
    {
      title: "List StreetEasy areas",
      description:
        "List StreetEasy area names and their numeric codes for use in search_rentals. " +
        "Optionally pass a search term to filter (e.g. 'brooklyn', 'harlem', 'williams'). " +
        "Names are matched case/spacing-insensitively.",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Optional substring to filter area names (case-insensitive)."),
      },
    },
    async (args: { search?: string }) => {
      const areas = listAreas(args.search);
      return jsonContent({ count: areas.length, areas });
    },
  );

  registerTool(
    server,
    "list_amenities",
    {
      title: "List StreetEasy amenities",
      description:
        "List the valid amenity enum tokens accepted by search_rentals (e.g. " +
        "WASHER_DRYER, DOORMAN, GYM, PRIVATE_OUTDOOR_SPACE).",
      inputSchema: {},
    },
    async () => {
      return jsonContent({ amenities: Object.values(Amenities) });
    },
  );

  return server;
}

interface SearchRentalsArgs {
  areas?: (string | number)[];
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  maxBathrooms?: number;
  amenities?: string[];
  petsAllowed?: boolean;
  noFeeOnly?: boolean;
  sortBy?: SortingAttribute;
  sortDirection?: SortingDirection;
  perPage?: number;
  page?: number;
}
