import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit } from "./types.ts";

type PreviewCopy = { eyebrow: string; headline: string; cta: string };
type PreviewRect = { x: number; y: number; width: number; height: number };

// Sample copy shown on the gallery preview only. The real ad's copy is generated
// per customer/suburb at build time; this just illustrates the template.
const PREVIEW_COPY: Record<string, PreviewCopy> = {
  just_listed: { eyebrow: "Just Listed", headline: "New on the market in your suburb", cta: "See the home" },
  coming_soon: { eyebrow: "Coming Soon", headline: "Something special is coming soon", cta: "Get first look" },
  new_to_market: { eyebrow: "New to Market", headline: "Fresh activity on your street", cta: "See recent sales" },
  open_home: { eyebrow: "Open Home", headline: "Open this Saturday - save your spot", cta: "Plan your visit" },
  just_sold: { eyebrow: "Just Sold", headline: "Sold - a strong local result", cta: "See what yours could get" },
  price_update: { eyebrow: "Price Update", headline: "What's your home worth now?", cta: "Get a price update" },
  market_update: { eyebrow: "Market Update", headline: "What sold near you this quarter", cta: "Get the report" },
  free_appraisal: { eyebrow: "Free Appraisal", headline: "What's your home worth in 2026?", cta: "Book free appraisal" },
  buyer_demand: { eyebrow: "Buyer Demand", headline: "Buyers are searching your suburb", cta: "Check buyer demand" },
  seller_checklist: { eyebrow: "Seller Checklist", headline: "10 things to fix before you list", cta: "Download checklist" },
};

const HEX = /^#?[0-9a-fA-F]{6}$/u;

function previewCopy(template: AdStudioTemplate): PreviewCopy {
  const key = safeString(template.templateKey ?? template.id);
  const templateName = safeString(template.name, "Template");
  const promptHint = safeString(template.promptHint, templateName);
  return (
    PREVIEW_COPY[key] ?? {
      eyebrow: templateName,
      headline: promptHint.length > 60 ? `${promptHint.slice(0, 57).trim()}...` : promptHint,
      cta: "Learn more",
    }
  );
}

function toWellFormedText(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += "?";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += "?";
    } else {
      output += value[index];
    }
  }
  return output;
}

function sanitisePreviewText(text: string): string {
  return toWellFormedText(text)
    .replace(/\u00e2\u20ac\u201d|\u2014/gu, "-")
    .replace(/\u00e2\u20ac\u00a6|\u2026/gu, "...")
    .replace(/\u00c2\u00b7|\u00b7/gu, "/")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, " ");
}

function cleanPreviewCopy(copy: PreviewCopy): PreviewCopy {
  return {
    eyebrow: sanitisePreviewText(copy.eyebrow),
    headline: sanitisePreviewText(copy.headline),
    cta: sanitisePreviewText(copy.cta),
  };
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? sanitisePreviewText(value.trim()) : fallback;
}

function esc(text: string): string {
  return sanitisePreviewText(text)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

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
  const words = sanitisePreviewText(text).split(/\s+/u).filter(Boolean);
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
      overflow = true;
      break;
    }
  }
  if (current) lines.push(current);
  if (overflow && lines.length > 0) {
    let last = lines[lines.length - 1].replace(/[.,;:]$/u, "");
    while (last.length > maxChars - 3 && last.includes(" ")) last = last.slice(0, last.lastIndexOf(" "));
    lines[lines.length - 1] = `${last}...`;
  }
  return lines;
}

function copyRectForTemplate(template: AdStudioTemplate, width: number, height: number): PreviewRect {
  const zones = Array.isArray(template.creativeSkeleton?.composition?.copy_safe_zones)
    ? template.creativeSkeleton.composition.copy_safe_zones
    : [];
  const zone = zones.find((candidate) => candidate.priority === "primary") ?? zones[0];
  if (!zone) return { x: 80, y: 910, width: width - 160, height: 300 };

  const margin = 64;
  const zoneX = finiteNumber(zone.x, 0.07);
  const zoneY = finiteNumber(zone.y, 0.58);
  const zoneWidth = finiteNumber(zone.width, 0.62);
  const zoneHeight = finiteNumber(zone.height, 0.25);
  const x = clampNumber(Math.round(zoneX * width), margin, width - margin - 360);
  const y = clampNumber(Math.round(zoneY * height), 190, height - 390);
  const rectWidth = clampNumber(Math.round(zoneWidth * width), 360, width - x - margin);
  const rectHeight = clampNumber(Math.round(zoneHeight * height), 250, height - y - 90);
  return { x, y, width: rectWidth, height: rectHeight };
}

function photoRectForCopyRect(copyRect: PreviewRect, width: number, height: number): PreviewRect {
  const margin = 80;
  const copyOnRight = copyRect.x + copyRect.width / 2 > width * 0.55;
  const copyLow = copyRect.y > height * 0.48;

  if (copyLow) {
    return { x: margin, y: 240, width: width - margin * 2, height: Math.max(360, copyRect.y - 300) };
  }

  if (copyOnRight) {
    return { x: margin, y: 250, width: Math.max(360, copyRect.x - margin * 1.5), height: 520 };
  }

  const x = Math.min(width - margin - 360, copyRect.x + copyRect.width + 42);
  return { x, y: 250, width: width - x - margin, height: 520 };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

const FONT = (kit: AdStudioBrandKit, kind: "heading" | "body") => {
  const named = kind === "heading" ? kit.typography?.headingFont : kit.typography?.bodyFont;
  const fallback = (kind === "heading" ? kit.typography?.fallbackHeading : kit.typography?.fallbackBody) || "sans-serif";
  const safeNamed = safeString(named);
  return `${safeNamed ? `'${safeNamed}', ` : ""}${fallback === "serif" ? "Georgia, 'Times New Roman', serif" : "'Helvetica Neue', Arial, sans-serif"}`;
};

/**
 * A clean, on-brand SVG preview of a template: customer colours, fonts and
 * business name, a clearly-marked "your listing photo" area, sample copy and
 * a brand CTA. It never bakes in observed-ad pixels.
 */
export function templatePreviewSvg(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  const W = 1080;
  const H = 1350;
  const primary = normaliseHex(brandKit.colours?.primary, "#14314f");
  const accent = normaliseHex(brandKit.colours?.accent, "#e7b24b");
  const deep = mixWithBlack(primary, 0.45);
  const copy = cleanPreviewCopy(previewCopy(template));
  const heading = FONT(brandKit, "heading");
  const body = FONT(brandKit, "body");
  const brandName = safeString(brandKit.identity?.tradingName || brandKit.identity?.businessName, "Your agency");
  const copyRect = copyRectForTemplate(template, W, H);
  const photoRect = photoRectForCopyRect(copyRect, W, H);

  const headlineSize = clampNumber(Math.round(copyRect.height * 0.24), 54, 78);
  const lineHeight = Math.round(headlineSize * 1.16);
  const headlineLines = wrapLines(copy.headline, Math.max(14, Math.floor(copyRect.width / (headlineSize * 0.48))), 2);
  const headTop = copyRect.y + Math.round(copyRect.height * 0.36) - (headlineLines.length - 1) * Math.round(lineHeight * 0.48);
  const headline = headlineLines
    .map((line, i) => `<text x="${copyRect.x + 36}" y="${headTop + i * lineHeight}" font-family="${heading}" font-size="${headlineSize}" font-weight="700" fill="#ffffff">${esc(line)}</text>`)
    .join("");

  const ctaText = copy.cta.length > 26 ? `${copy.cta.slice(0, 25)}...` : copy.cta;
  const safeCtaText = sanitisePreviewText(ctaText);
  const footerText = "Your brand / your photo / written for your suburb";
  const ctaWidth = Math.min(copyRect.width - 72, Math.max(320, safeCtaText.length * 22 + 90));
  const ctaY = Math.min(copyRect.y + copyRect.height - 92, H - 145);
  const cx = photoRect.x + photoRect.width / 2;
  const cy = photoRect.y + photoRect.height / 2 - 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <desc>${esc(copy.headline)}</desc>
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

  <rect x="${photoRect.x}" y="${photoRect.y}" width="${photoRect.width}" height="${photoRect.height}" rx="20" fill="#ffffff" fill-opacity="0.10" stroke="#ffffff" stroke-opacity="0.22" stroke-dasharray="10 10"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <rect x="${cx - 90}" y="${cy - 70}" width="180" height="140" rx="12"/>
    <circle cx="${cx - 40}" cy="${cy - 28}" r="18"/>
    <path d="M${cx - 78} ${cy + 56} L${cx - 20} ${cy} L${cx + 24} ${cy + 36} L${cx + 50} ${cy + 12} L${cx + 78} ${cy + 56}"/>
  </g>
  <text x="${cx}" y="${photoRect.y + photoRect.height - 34}" font-family="${body}" font-size="28" fill="#ffffff" fill-opacity="0.72" text-anchor="middle">Your listing photo</text>

  <rect x="${copyRect.x}" y="${copyRect.y}" width="${copyRect.width}" height="${copyRect.height}" rx="18" fill="#06111f" fill-opacity="0.58"/>
  <rect x="${copyRect.x}" y="${copyRect.y}" width="10" height="${copyRect.height}" rx="5" fill="${accent}"/>

  ${headline}

  <rect x="${copyRect.x + 36}" y="${ctaY}" width="${ctaWidth}" height="82" rx="14" fill="${accent}"/>
  <text x="${copyRect.x + 36 + ctaWidth / 2}" y="${ctaY + 54}" font-family="${body}" font-size="32" font-weight="700" fill="${mixWithBlack(accent, 0.72)}" text-anchor="middle">${esc(safeCtaText)}</text>

  <text x="80" y="1316" font-family="${body}" font-size="22" fill="#ffffff" fill-opacity="0.72">${esc(footerText)}</text>
</svg>`;
}

export function templatePreviewDataUrl(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  try {
    return `data:image/svg+xml;utf8,${encodeURIComponent(toWellFormedText(templatePreviewSvg(template, brandKit)))}`;
  } catch {
    return fallbackTemplatePreviewDataUrl();
  }
}

function fallbackTemplatePreviewDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#14314f"/><rect x="90" y="260" width="900" height="520" rx="22" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.3" stroke-dasharray="14 14"/><text x="540" y="540" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="#ffffff" text-anchor="middle">Your listing photo</text><rect x="90" y="880" width="720" height="250" rx="18" fill="#06111f" fill-opacity="0.58"/><text x="132" y="990" font-family="Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff">Template preview</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
