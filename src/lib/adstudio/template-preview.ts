import { sanitizeSampleCopy, type AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit } from "./types.ts";

// Sample copy shown on the gallery preview only. The real ad's copy is generated
// per customer/suburb at build time; this just illustrates the template.
const PREVIEW_COPY: Record<string, { eyebrow: string; headline: string; cta: string }> = {
  just_listed: { eyebrow: "Just Listed", headline: "New on the market in your suburb", cta: "See the home" },
  coming_soon: { eyebrow: "Coming Soon", headline: "Something special is coming soon", cta: "Get first look" },
  new_to_market: { eyebrow: "New to Market", headline: "Fresh activity on your street", cta: "See recent sales" },
  open_home: { eyebrow: "Open Home", headline: "Open this Saturday — save your spot", cta: "Plan your visit" },
  just_sold: { eyebrow: "Just Sold", headline: "Sold — a strong local result", cta: "See what yours could get" },
  price_update: { eyebrow: "Price Update", headline: "What's your home worth now?", cta: "Get a price update" },
  market_update: { eyebrow: "Market Update", headline: "What sold near you this quarter", cta: "Get the report" },
  free_appraisal: { eyebrow: "Free Appraisal", headline: "What's your home worth in 2026?", cta: "Book free appraisal" },
  buyer_demand: { eyebrow: "Buyer Demand", headline: "Buyers are searching your suburb", cta: "Check buyer demand" },
  seller_checklist: { eyebrow: "Seller Checklist", headline: "10 things to fix before you list", cta: "Download checklist" },
};

function previewCopy(template: AdStudioTemplate): { eyebrow: string; headline: string; cta: string } {
  // Prefer the template's own clean sample copy, then the curated built-in copy,
  // then a sanitised one-liner. Everything is sanitised again here so no prompt
  // scaffolding ({{tokens}}, layout directives) can ever render on a card.
  if (template.preview?.headline) {
    return {
      eyebrow: sanitizeSampleCopy(template.preview.eyebrow) || template.name,
      headline: sanitizeSampleCopy(template.preview.headline),
      cta: sanitizeSampleCopy(template.preview.cta) || "Learn more",
    };
  }
  const builtIn = PREVIEW_COPY[template.id];
  if (builtIn) return builtIn;
  const hint = sanitizeSampleCopy(template.promptHint);
  return {
    eyebrow: template.name,
    headline: hint.length > 60 ? `${hint.slice(0, 57).trim()}…` : hint || template.name,
    cta: "Learn more",
  };
}

function esc(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

const HEX = /^#?[0-9a-fA-F]{6}$/u;

function normaliseHex(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  if (HEX.test(v)) return v.startsWith("#") ? v : `#${v}`;
  return fallback;
}

function mixWithBlack(hex: string, amount: number): string {
  const m = hex.replace("#", "");
  const r = Math.round(parseInt(m.slice(0, 2), 16) * (1 - amount));
  const g = Math.round(parseInt(m.slice(2, 4), 16) * (1 - amount));
  const b = Math.round(parseInt(m.slice(4, 6), 16) * (1 - amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Naive but reliable word-wrap for SVG <text> (which never auto-wraps): split
// into at most `maxLines` lines that fit `maxChars`, ellipsising the overflow.
function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let overflow = false;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else if (lines.length < maxLines - 1) {
      if (current) lines.push(current);
      current = word;
    } else {
      overflow = true; // no room left; remaining words are dropped
      break;
    }
  }
  if (current) lines.push(current);
  if (overflow && lines.length > 0) {
    let last = lines[lines.length - 1].replace(/[.,;:]$/u, "");
    while (last.length > maxChars - 1 && last.includes(" ")) last = last.slice(0, last.lastIndexOf(" "));
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

const FONT = (kit: AdStudioBrandKit, kind: "heading" | "body") => {
  const named = kind === "heading" ? kit.typography.headingFont : kit.typography.bodyFont;
  const fallback = (kind === "heading" ? kit.typography.fallbackHeading : kit.typography.fallbackBody) || "sans-serif";
  return `${named ? `'${named}', ` : ""}${fallback === "serif" ? "Georgia, 'Times New Roman', serif" : "'Helvetica Neue', Arial, sans-serif"}`;
};

/**
 * A clean, on-brand SVG preview of a template — the customer's brand colours,
 * fonts and business name, a clearly-marked "your listing photo" area, sample
 * copy and a brand CTA. Shows what the template becomes once they add a photo,
 * personalised to the viewing customer. Never bakes in an invented property.
 */
export function templatePreviewSvg(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  const W = 1080;
  const H = 1350;
  const primary = normaliseHex(brandKit.colours.primary, "#14314f");
  const accent = normaliseHex(brandKit.colours.accent, "#e7b24b");
  const deep = mixWithBlack(primary, 0.45);
  const copy = previewCopy(template);
  const heading = FONT(brandKit, "heading");
  const body = FONT(brandKit, "body");
  const brandName = (brandKit.identity.tradingName || brandKit.identity.businessName || "Your agency").trim();

  const headlineLines = wrapLines(copy.headline, 22, 2);
  const headlineSize = 78;
  const lineHeight = 92;
  const headTop = 1066 - (headlineLines.length - 1) * lineHeight;
  const headline = headlineLines
    .map((line, i) => `<text x="80" y="${headTop + i * lineHeight}" font-family="${heading}" font-size="${headlineSize}" font-weight="700" fill="#ffffff">${esc(line)}</text>`)
    .join("");

  const ctaText = copy.cta.length > 26 ? `${copy.cta.slice(0, 25)}…` : copy.cta;
  const ctaWidth = Math.min(W - 160, Math.max(360, ctaText.length * 24 + 96));
  const ctaY = 1150;

  // "Your listing photo" placeholder band in the upper area.
  const photoTop = 250;
  const photoH = 470;
  const cx = W / 2;
  const cy = photoTop + photoH / 2 - 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${primary}"/>
      <stop offset="1" stop-color="${deep}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${accent}"/>

  <text x="80" y="130" font-family="${body}" font-size="34" font-weight="700" fill="#ffffff" letter-spacing="1">${esc(brandName)}</text>
  <text x="80" y="180" font-family="${body}" font-size="26" font-weight="700" fill="${accent}" letter-spacing="4">${esc(copy.eyebrow.toUpperCase())}</text>

  <rect x="80" y="${photoTop}" width="${W - 160}" height="${photoH}" rx="20" fill="#ffffff" fill-opacity="0.10" stroke="#ffffff" stroke-opacity="0.22" stroke-dasharray="10 10"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <rect x="${cx - 90}" y="${cy - 70}" width="180" height="140" rx="12"/>
    <circle cx="${cx - 40}" cy="${cy - 28}" r="18"/>
    <path d="M${cx - 78} ${cy + 56} L${cx - 20} ${cy} L${cx + 24} ${cy + 36} L${cx + 50} ${cy + 12} L${cx + 78} ${cy + 56}"/>
  </g>
  <text x="${cx}" y="${photoTop + photoH - 34}" font-family="${body}" font-size="28" fill="#ffffff" fill-opacity="0.72" text-anchor="middle">Your listing photo</text>

  ${headline}

  <rect x="80" y="${ctaY}" width="${ctaWidth}" height="92" rx="14" fill="${accent}"/>
  <text x="${80 + ctaWidth / 2}" y="${ctaY + 60}" font-family="${body}" font-size="36" font-weight="700" fill="${mixWithBlack(accent, 0.72)}" text-anchor="middle">${esc(ctaText)}</text>
</svg>`;
}

export function templatePreviewDataUrl(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(templatePreviewSvg(template, brandKit))}`;
}
