// Generates on-brand 1080x1350 designed cards for each built-in Ad Studio
// template and writes them to public/ads/templates/<id>.png.
//
// Pure SVG -> PNG via sharp (no headless browser needed). The visual language
// matches the existing ad-template-library mockups: deep navy gradient, teal
// eyebrow + line-art icon, white headline, gold CTA pill, fine-print disclaimer.
//
// Run: node scripts/generate-template-images.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "ads", "templates");

const W = 1080;
const H = 1350;
const FONT = "Liberation Sans, DejaVu Sans, Arial, sans-serif";

const PALETTE = {
  teal: "#4FB59C",
  tealSoft: "#8fd3c2",
  gold: "#E7B24B",
  ink: "#0c1c2e",
  white: "#ffffff",
  muted: "#9fb6c9",
};

// Line-art icons (stroke-based), drawn on a 0..240 box centred at the anchor.
const ICONS = {
  house: `<path d="M40 120 L120 52 L200 120 M64 104 L64 196 L176 196 L176 104 M104 196 L104 150 L140 150 L140 196" />`,
  key: `<circle cx="86" cy="96" r="44" /><path d="M118 128 L196 206 M168 178 L188 158 M150 196 L170 176" />`,
  calendar: `<rect x="46" y="64" width="148" height="132" rx="12" /><path d="M46 104 L194 104 M86 48 L86 80 M154 48 L154 80" /><circle cx="92" cy="140" r="9" fill="currentColor" stroke="none"/><circle cx="148" cy="140" r="9" fill="currentColor" stroke="none"/>`,
  magnifier: `<circle cx="104" cy="104" r="60" /><path d="M148 148 L200 200" /><path d="M104 78 L104 130 M78 104 L130 104" />`,
  checklist: `<rect x="52" y="48" width="136" height="156" rx="12" /><path d="M84 92 L100 108 L132 76 M84 150 L100 166 L132 134" />`,
  graph: `<path d="M52 196 L52 52 M52 196 L196 196 M76 168 L112 124 L140 148 L184 84" /><path d="M168 84 L184 84 L184 100" />`,
  tag: `<path d="M60 60 L132 60 L196 124 L124 196 L60 132 Z" /><circle cx="96" cy="96" r="14" fill="currentColor" stroke="none"/>`,
};

// templateId -> design. eyebrow + headline lines + cta + icon + accent.
const TEMPLATES = [
  { id: "just_listed", eyebrow: "Just Listed", lines: ["New on the", "market in", "your suburb"], cta: "See the home", icon: "key", accent: PALETTE.teal },
  { id: "coming_soon", eyebrow: "Coming Soon", lines: ["Something", "special is", "coming soon"], cta: "Get first look", icon: "house", accent: PALETTE.tealSoft },
  { id: "new_to_market", eyebrow: "New to Market", lines: ["Fresh activity", "on your", "street"], cta: "See recent sales", icon: "graph", accent: PALETTE.teal },
  { id: "open_home", eyebrow: "Open Home", lines: ["Open Saturday", "11:00 AM"], cta: "Plan your visit", icon: "calendar", accent: PALETTE.teal, sub: "Save your spot before it books out" },
  { id: "just_sold", eyebrow: "Just Sold", lines: ["Sold — a strong", "local result"], cta: "See what yours could get", icon: "tag", accent: PALETTE.gold, ribbon: "SOLD", sub: "Another home sold in your area" },
  { id: "price_update", eyebrow: "Price Update", lines: ["What's your", "home worth", "now?"], cta: "Get a price update", icon: "graph", accent: PALETTE.teal },
  { id: "market_update", eyebrow: "Market Update", lines: ["What sold near", "you this", "quarter"], cta: "Get the report", icon: "magnifier", accent: PALETTE.teal, sub: "Free local sales snapshot" },
  { id: "free_appraisal", eyebrow: "Free Appraisal", lines: ["What's your", "home worth", "in 2026?"], cta: "Book free appraisal", icon: "house", accent: PALETTE.gold, sub: "No-pressure local price update" },
  { id: "buyer_demand", eyebrow: "Buyer Demand", lines: ["Buyers are", "searching", "your suburb"], cta: "Check buyer demand", icon: "magnifier", accent: PALETTE.teal },
  { id: "seller_checklist", eyebrow: "Seller Checklist", lines: ["10 things to fix", "before you", "list"], cta: "Download checklist", icon: "checklist", accent: PALETTE.teal },
];

function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvg(t) {
  const lineHeight = 104;
  const headTop = 392;
  const headline = t.lines
    .map((line, i) => `<text x="72" y="${headTop + i * lineHeight}" font-size="92" font-weight="bold" fill="${PALETTE.white}" letter-spacing="-1">${esc(line)}</text>`)
    .join("");

  const iconY = headTop + t.lines.length * lineHeight + 40;
  const icon = `<g transform="translate(72 ${iconY})" stroke="${t.accent}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none" color="${t.accent}">${ICONS[t.icon]}</g>`;

  const sub = t.sub
    ? `<text x="72" y="${iconY + 300}" font-size="34" fill="${PALETTE.muted}">${esc(t.sub)}</text>`
    : "";

  const ribbon = t.ribbon
    ? `<g transform="translate(880 70) rotate(45)"><rect x="-140" y="-34" width="280" height="64" fill="${PALETTE.gold}"/><text x="0" y="10" font-size="34" font-weight="bold" fill="${PALETTE.ink}" text-anchor="middle" letter-spacing="3">${esc(t.ribbon)}</text></g>`
    : "";

  const ctaY = 1148;
  const cta = `<rect x="72" y="${ctaY}" width="936" height="104" rx="14" fill="${PALETTE.gold}"/>` +
    `<text x="540" y="${ctaY + 67}" font-size="40" font-weight="bold" fill="${PALETTE.ink}" text-anchor="middle">${esc(t.cta)}  →</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#16314f"/>
      <stop offset="1" stop-color="#0a1a2b"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.06" r="0.6">
      <stop offset="0" stop-color="${PALETTE.gold}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${PALETTE.gold}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="14" fill="${t.accent}"/>
  <text x="72" y="168" font-size="26" fill="${PALETTE.muted}" letter-spacing="3">BLOCKWISE · LOCAL REAL ESTATE</text>
  <text x="72" y="250" font-size="36" font-weight="bold" fill="${t.accent}" letter-spacing="6">${esc(t.eyebrow.toUpperCase())}</text>
  ${headline}
  ${icon}
  ${sub}
  ${ribbon}
  ${cta}
  <text x="540" y="1320" font-size="24" fill="${PALETTE.muted}" text-anchor="middle" opacity="0.8">General information only · Speak with your licensed local agent</text>
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const t of TEMPLATES) {
    const svg = buildSvg(t);
    const out = join(OUT_DIR, `${t.id}.png`);
    await sharp(Buffer.from(svg)).png().toFile(out);
    console.log(`wrote ${out}`);
  }
  console.log(`\nGenerated ${TEMPLATES.length} template images.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
