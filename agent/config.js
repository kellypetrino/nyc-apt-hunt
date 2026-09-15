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
// virtual doorman, and search results don't include enough detail to tell
// them apart automatically (checking would mean a get_rental_details call
// per listing, which is what was tripping bot detection) — so doorman type
// isn't verified here. Spot-check on StreetEasy before ruling a building in
// or out.
export const NICE_TO_HAVES = {
  twoBaths: (listing) => Number(listing.bathrooms) >= 2,
};

export const RECIPIENT_EMAIL = "petrinokelly@gmail.com";
