import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let db;

async function getDb() {
  if (db) return db;
  const raw = await readFile(
    new URL("./firebase-service-account.json", import.meta.url)
  );
  const serviceAccount = JSON.parse(raw);
  const app = initializeApp({ credential: cert(serviceAccount) });
  db = getFirestore(app);
  return db;
}

/**
 * Inserts new listings into the `listings` collection, keyed by StreetEasy
 * listing id (idempotent — re-running never duplicates or overwrites a
 * listing's status). Only ever called with listings not already in
 * state/seen_listings.json, so this never clobbers a status set from the
 * mobile tracker page.
 */
export async function syncToFirestore(listings) {
  if (listings.length === 0) return;

  const firestore = await getDb();
  const batch = firestore.batch();
  for (const listing of listings) {
    const ref = firestore.collection("listings").doc(String(listing.id));
    batch.set(ref, {
      id: listing.id,
      address: listing.address,
      neighborhood: listing.neighborhood,
      price: listing.price,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      url: listing.url,
      leadPhotoUrl: listing.leadPhotoUrl || null,
      status: "new",
      notes: "",
      createdAt: new Date().toISOString(),
    });
  }
  await batch.commit();
}
