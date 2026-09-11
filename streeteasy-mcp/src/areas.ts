import { Areas } from "./streeteasy/constants";

// name (e.g. "WILLIAMSBURG") -> numeric area code
const NAME_TO_CODE = Areas as Record<string, number>;

// numeric code -> canonical name, for labeling results / reverse lookups
const CODE_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(NAME_TO_CODE).map(([name, code]) => [code, name]),
);

/**
 * Resolve a user-supplied area reference to a StreetEasy numeric area code.
 * Accepts either a numeric code (passed through if known) or a name like
 * "MANHATTAN" / "Williamsburg" / "upper east side" (case/spacing/dash
 * insensitive). Throws with a helpful message on an unknown value.
 */
export function resolveAreaCode(area: string | number): number {
  if (typeof area === "number") {
    if (CODE_TO_NAME[area]) return area;
    throw new Error(
      `Unknown StreetEasy area code: ${area}. Use list_areas to find valid codes.`,
    );
  }
  const raw = String(area).trim();
  // A numeric string like "100"
  if (/^\d+$/.test(raw)) return resolveAreaCode(Number(raw));

  const key = normalizeName(raw);
  const match = Object.keys(NAME_TO_CODE).find((n) => normalizeName(n) === key);
  if (match) return NAME_TO_CODE[match];

  throw new Error(
    `Unknown StreetEasy area: "${area}". Use list_areas (optionally with a search term) to find valid area names/codes.`,
  );
}

function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

export function areaName(code: number): string | undefined {
  return CODE_TO_NAME[code];
}

export interface AreaEntry {
  name: string;
  code: number;
}

/** All areas, optionally filtered by a case-insensitive substring of the name. */
export function listAreas(search?: string): AreaEntry[] {
  const entries: AreaEntry[] = Object.entries(NAME_TO_CODE).map(
    ([name, code]) => ({ name, code }),
  );
  if (!search) return entries;
  const q = normalizeName(search);
  return entries.filter((e) => normalizeName(e.name).includes(q));
}
