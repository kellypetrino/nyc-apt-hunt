import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const STATE_PATH = new URL("../state/seen_listings.json", import.meta.url);

export async function loadSeenIds() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return new Set(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return new Set();
    throw err;
  }
}

export async function saveSeenIds(idSet) {
  await mkdir(dirname(STATE_PATH.pathname), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify([...idSet].sort(), null, 2));
}
