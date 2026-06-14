// Generates a real-estate-ad-style creative for each built-in Ad Studio
// template and writes it to public/ads/templates/<id>.png.
//
// Each card is a property photo (cover) + a dark scrim for legibility + a text
// layer (brand kicker, eyebrow, headline, CTA pill, disclaimer) composited with
// sharp — so the gallery reads like real ads, the way Ad Radar shows creatives.
// No headless browser needed.
//
// Run: node scripts/generate-template-images.mjs
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const OUT_DIR = join(PUBLIC_DIR, "ads", "templates");

const W = 1080;
const H = 1350;
const FONT = "Liberation Sans, DejaVu Sans, Arial, sans-serif";
const GOLD = "#E7B24B";
const TEAL = "#4FB59C";
const WHITE = "#ffffff";

// Shared property photography (already shipped under public/ads).
const PHOTO = {
  skyline: "ads/ad-northstar.jpg",
  familyHome: "ads/ad-hillview.jpg",
  livingRoom: "ads/ad-hillco.jpg",
  riverView: "ads/ad-coastline.jpg",
};

// templateId -> design. photo + crop position + accent vary per template so that
// even where photos repeat (only four exist) no two cards read the same.
const TEMPLATES = [
  { id: "just_listed", photo: "familyHome", crop: "centre", accent: GOLD, eyebrow: "Just Listed", lines: ["New on the", "market in", "your suburb"], cta: "See the home" },
  { id: "coming_soon", photo: "skyline", crop: "top", accent: TEAL, eyebrow: "Coming Soon", lines: ["Something special", "is coming soon"], cta: "Get first look" },
  { id: "new_to_market", photo: "riverView", crop: "centre", accent: GOLD, eyebrow: "New to Market", lines: ["Fresh activity", "on your street"], cta: "See recent sales" },
  { id: "open_home", photo: "livingRoom", crop: "centre", accent: TEAL, eyebrow: "Open Home", lines: ["Open Saturday", "11:00 AM"], cta: "Plan your visit" },
  { id: "just_sold", photo: "familyHome", crop: "bottom", accent: GOLD, eyebrow: "Just Sold", lines: ["A strong", "local result"], cta: "See what yours could get", ribbon: "SOLD" },
  { id: "price_update", photo: "riverView", crop: "top", accent: TEAL, eyebrow: "Price Update", lines: ["What's your home", "worth now?"], cta: "Get a price update" },
  { id: "market_update", photo: "skyline", crop: "bottom", accent: GOLD, eyebrow: "Market Update", lines: ["What sold near", "you this quarter"], cta: "Get the report" },
  { id: "free_appraisal", photo: "livingRoom", crop: "top", accent: TEAL, eyebrow: "Free Appraisal", lines: ["What's your home", "worth in 2026?"], cta: "Book free appraisal" },
  { id: "buyer_demand", photo: "riverView", crop: "bottom", accent: GOLD, eyebrow: "Buyer Demand", lines: ["Buyers are", "searching your", "suburb"], cta: "Check buyer demand" },
  { id: "seller_checklist", photo: "familyHome", crop: "top", accent: TEAL, eyebrow: "Seller Checklist", lines: ["10 things to fix", "before you list"], cta: "Download checklist" },
];

const CROP_POSITION = { top: "top", centre: "centre", bottom: "bottom" };

function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function overlaySvg(t) {
  const lineHeight = 96;
  // Anchor the headline block in the lower third so it sits over the scrim.
  const blockBottom = 1112;
  const headTop = blockBottom - (t.lines.length - 1) * lineHeight;
  const headline = t.lines
    .map((line, i) => `<text x="72" y="${headTop + i * lineHeight}" font-size="88" font-weight="bold" fill="${WHITE}" letter-spacing="-1">${esc(line)}</text>`)
    .join("");

  const eyebrowY = headTop - (t.lines.length > 2 ? 150 : 118);

  const ribbon = t.ribbon
    ? `<g transform="translate(902 88) rotate(45)"><rect x="-150" y="-36" width="300" height="70" fill="${GOLD}"/><text x="0" y="12" font-size="38" font-weight="bold" fill="#0c1c2e" text-anchor="middle" letter-spacing="4">${esc(t.ribbon)}</text></g>`
    : "";

  const ctaY = 1190;
  const cta = `<rect x="72" y="${ctaY}" width="936" height="104" rx="14" fill="${GOLD}"/>` +
    `<text x="540" y="${ctaY + 67}" font-size="40" font-weight="bold" fill="#0c1c2e" text-anchor="middle">${esc(t.cta)}  →</text>`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#08111d" stop-opacity="0.55"/>
      <stop offset="0.34" stop-color="#08111d" stop-opacity="0.05"/>
      <stop offset="0.62" stop-color="#08111d" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#08111d" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect x="0" y="0" width="${W}" height="12" fill="${t.accent}"/>
  <text x="72" y="120" font-size="30" font-weight="bold" fill="${WHITE}" letter-spacing="4">BLOCKWISE</text>
  <text x="72" y="158" font-size="22" fill="#dce6f0" letter-spacing="3">LOCAL REAL ESTATE</text>
  <text x="72" y="${eyebrowY}" font-size="34" font-weight="bold" fill="${t.accent}" letter-spacing="5">${esc(t.eyebrow.toUpperCase())}</text>
  ${headline}
  ${ribbon}
  ${cta}
  <text x="540" y="1330" font-size="22" fill="#cdd9e6" text-anchor="middle" opacity="0.85">General information only · Speak with your licensed local agent</text>
</svg>`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const t of TEMPLATES) {
    const photoPath = join(PUBLIC_DIR, PHOTO[t.photo]);
    const base = await sharp(photoPath).resize(W, H, { fit: "cover", position: CROP_POSITION[t.crop] ?? "centre" }).toBuffer();
    const out = join(OUT_DIR, `${t.id}.png`);
    await sharp(base).composite([{ input: overlaySvg(t), top: 0, left: 0 }]).png().toFile(out);
    console.log(`wrote ${out}`);
  }
  console.log(`\nGenerated ${TEMPLATES.length} template images.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
