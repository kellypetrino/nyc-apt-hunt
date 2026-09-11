import type {
  RentalEdge,
  SearchRentalListing,
  SearchRentalsResponse,
} from "./streeteasy/types";
import { areaName } from "./areas";

const SE_BASE = "https://streeteasy.com";
const PHOTO_CDN = "https://photos.zillowstatic.com/fp";

/**
 * Resolve a StreetEasy photo/floorplan key to a CDN image URL. StreetEasy
 * photos are served from Zillow's CDN with a size suffix; "large"
 * (800x400) and "medium" (500x250) are the variants that resolve.
 */
export function photoUrl(key: string, size: "large" | "medium" = "large"): string {
  const sfx = size === "medium" ? "se_medium_500_250" : "se_large_800_400";
  return `${PHOTO_CDN}/${key}-${sfx}.jpg`;
}

interface KeyedPhoto {
  key?: string | null;
}

/** Map an array of {key} photo objects to CDN image URLs (skipping empties). */
export function photoUrls(
  photos: KeyedPhoto[] | undefined | null,
  size: "large" | "medium" = "large",
): string[] {
  return (photos ?? [])
    .filter((p): p is { key: string } => Boolean(p && p.key))
    .map((p) => photoUrl(p.key, size));
}

interface RawVideo {
  id?: string;
  provider?: string;
  imageUrl?: string | null;
}

export interface VideoLink {
  id: string | null;
  provider: string | null;
  watchUrl: string | null;
  thumbnailUrl: string | null;
}

/** Turn raw video objects into playable links (YouTube/Vimeo) + thumbnails. */
export function videoLinks(videos: RawVideo[] | undefined | null): VideoLink[] {
  return (videos ?? []).map((v) => {
    const provider = (v.provider || "").toUpperCase();
    let watchUrl: string | null = null;
    if (v.id && provider === "YOUTUBE") {
      watchUrl = `https://www.youtube.com/watch?v=${v.id}`;
    } else if (v.id && provider === "VIMEO") {
      watchUrl = `https://vimeo.com/${v.id}`;
    }
    return {
      id: v.id ?? null,
      provider: v.provider ?? null,
      watchUrl,
      thumbnailUrl: v.imageUrl ?? null,
    };
  });
}

/** Build a navigable StreetEasy URL from a listing's urlPath (which may start with `//`). */
export function listingUrl(urlPath: string | undefined, id: string): string {
  if (urlPath) {
    const cleaned = urlPath.replace(/^\/+/, "");
    return `${SE_BASE}/${cleaned}`;
  }
  return `${SE_BASE}/rental/${id}`;
}

function edgeKind(edge: RentalEdge): string {
  switch (edge.__typename) {
    case "FeaturedRentalEdge":
      return "featured";
    case "SponsoredRentalEdge":
      return "sponsored";
    default:
      return "organic";
  }
}

/** Flatten a single search edge into a compact, agent-friendly listing object. */
function normalizeListing(edge: RentalEdge) {
  const n: SearchRentalListing = edge.node;
  const bath =
    n.fullBathroomCount + (n.halfBathroomCount ? n.halfBathroomCount * 0.5 : 0);
  const out: Record<string, unknown> = {
    id: n.id,
    kind: edgeKind(edge),
    address: [n.street, n.unit].filter(Boolean).join(" ").trim(),
    street: n.street,
    unit: n.unit || null,
    neighborhood: n.areaName,
    price: n.price,
    netEffectivePrice: n.netEffectivePrice,
    noFee: n.noFee,
    monthsFree: n.monthsFree,
    priceDelta: n.priceDelta,
    bedrooms: n.bedroomCount,
    bathrooms: bath,
    fullBathrooms: n.fullBathroomCount,
    halfBathrooms: n.halfBathroomCount,
    livingAreaSize: n.livingAreaSize,
    buildingType: n.buildingType,
    furnished: n.furnished,
    status: n.status,
    availableAt: n.availableAt,
    leaseTermMonths: n.leaseTermMonths,
    isNewDevelopment: n.isNewDevelopment,
    hasVideos: n.hasVideos,
    hasTour3d: n.hasTour3d,
    mediaAssetCount: n.mediaAssetCount,
    sourceGroupLabel: n.sourceGroupLabel,
    geo: n.geoPoint
      ? { latitude: n.geoPoint.latitude, longitude: n.geoPoint.longitude }
      : null,
    url: listingUrl(n.urlPath, n.id),
    slug: n.slug,
    leadPhotoUrl: n.leadMedia?.photo?.key
      ? photoUrl(n.leadMedia.photo.key)
      : null,
    photoUrls: photoUrls(n.photos),
  };

  // Amenity-match metadata only exists on organic/featured edges
  if ("amenitiesMatch" in edge) {
    out.amenitiesMatch = edge.amenitiesMatch;
    out.matchedAmenities = edge.matchedAmenities ?? [];
    out.missingAmenities = edge.missingAmenities ?? [];
  }
  return out;
}

export interface NormalizedSearch {
  totalCount: number;
  page: number;
  perPage: number;
  returned: number;
  listings: Record<string, unknown>[];
}

export function normalizeSearch(
  res: SearchRentalsResponse,
  opts: { page: number; perPage: number; noFeeOnly?: boolean },
): NormalizedSearch {
  let listings = res.searchRentals.edges
    .filter((e) => e && e.node)
    .map(normalizeListing);

  if (opts.noFeeOnly) {
    listings = listings.filter((l) => l.noFee === true);
  }

  return {
    totalCount: res.searchRentals.totalCount,
    page: opts.page,
    perPage: opts.perPage,
    returned: listings.length,
    listings,
  };
}

/** Recursively strip GraphQL `__typename` keys and drop null/empty noise lightly. */
export function stripTypename<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripTypename(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "__typename") continue;
      out[k] = stripTypename(v);
    }
    return out as T;
  }
  return value;
}

export { areaName };
