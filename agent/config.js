export const AREAS = [
  "UPPER_EAST_SIDE",
  "GRAMERCY_PARK",
  "TRIBECA",
  "CHELSEA",
  "FLATIRON",
  "KIPS_BAY",
];

export const FILTERS = {
  areas: AREAS,
  minPrice: 6000,
  maxPrice: 8000,
  minBedrooms: 2,
  maxBedrooms: 2,
  amenities: ["DOORMAN"],
  perPage: 100,
  sortBy: "PRICE",
  sortDirection: "ASCENDING",
};

// StreetEasy's DOORMAN amenity token doesn't distinguish full-time vs.
// virtual doorman. Listings whose description mentions "virtual doorman"
// are excluded client-side.
export const VIRTUAL_DOORMAN_PATTERN = /virtual\s+doorman/i;

export const NICE_TO_HAVES = {
  washerDryer: (listing) => (listing.amenities || []).includes("WASHER_DRYER"),
  twoBaths: (listing) => Number(listing.bathrooms) >= 2,
};

export const RECIPIENT_EMAIL = "petrinokelly@gmail.com";
