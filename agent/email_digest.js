import nodemailer from "nodemailer";
import { NICE_TO_HAVES, RECIPIENT_EMAIL } from "./config.js";

function isNiceToHave(listing) {
  return NICE_TO_HAVES.twoBaths(listing);
}

function sortListings(listings) {
  return [...listings].sort((a, b) => Number(isNiceToHave(b)) - Number(isNiceToHave(a)));
}

function formatMoney(n) {
  return `$${Number(n).toLocaleString()}`;
}

function listingHtml(listing) {
  const badges = [];
  if (NICE_TO_HAVES.twoBaths(listing)) badges.push("2 baths");
  const badgeHtml = badges.length
    ? `<div style="margin-top:4px;">${badges
        .map(
          (b) =>
            `<span style="background:#eef7ee;color:#1a7a1a;border-radius:4px;padding:2px 8px;font-size:12px;margin-right:6px;">${b}</span>`
        )
        .join("")}</div>`
    : "";
  const photo = listing.leadPhotoUrl
    ? `<img src="${listing.leadPhotoUrl}" alt="" style="width:100%;max-width:360px;border-radius:8px;display:block;" />`
    : "";

  return `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #eee;">
        ${photo}
        <div style="font-size:16px;font-weight:600;margin-top:8px;">${formatMoney(
          listing.price
        )}/mo — ${listing.address}</div>
        <div style="color:#555;font-size:14px;">${listing.neighborhood} · ${
    listing.bedrooms
  } bd / ${listing.bathrooms} ba</div>
        ${badgeHtml}
        <div style="margin-top:8px;">
          <a href="${listing.url}" style="color:#0a66c2;">View on StreetEasy →</a>
        </div>
      </td>
    </tr>`;
}

function digestHtml(listings) {
  const rows = sortListings(listings).map(listingHtml).join("\n");
  return `<html><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;">
    <h2>${listings.length} new apartment${listings.length === 1 ? "" : "s"}</h2>
    <p style="color:#888;font-size:12px;">Doorman type isn't auto-verified (StreetEasy's filter doesn't distinguish full-time from virtual) — check each listing before ruling it in or out.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  </body></html>`;
}

export async function sendDigest(listings) {
  if (listings.length === 0) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.GMAIL_ADDRESS,
    to: RECIPIENT_EMAIL,
    subject: `${listings.length} new NYC apartment${listings.length === 1 ? "" : "s"} match your search`,
    html: digestHtml(listings),
  });
}
