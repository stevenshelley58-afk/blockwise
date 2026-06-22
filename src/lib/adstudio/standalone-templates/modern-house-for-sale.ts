// STANDALONE mini-project template: "Modern House For Sale" (clone of reference meta_023).
//
// This module is intentionally self-contained. It imports ONLY types (erased at
// runtime) and shares NO rendering logic with the legacy template-design DSL or
// renderDesign. Every coordinate/palette value below was measured from the real
// reference file meta_023.png and is hand-authored for THIS one design.
//
// It exposes:
//   - renderModernHouseForSaleSvg(content) -> bespoke SVG string
//   - renderModernHouseForSaleCreative(input) -> AdStudioCreative (request-path contract)
//   - modernHouseForSaleTemplate -> gallery/registry descriptor
//   - modernHouseForSaleSample -> defaults used to render the gallery sample card
import type { AdStudioBrandKit, AdStudioCreative, AdStudioFormat } from "../types.ts";
import type { AdStudioTemplate } from "../templates.ts";

const ID = "standalone_modern_house_for_sale";
const VERSION = "standalone-meta023-v1";

const CANVAS: Record<AdStudioFormat, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "1.91:1": { width: 1200, height: 628 },
};

// measured from meta_023
const DEFAULT_PALETTE = {
  bg: "#ECE9E2",
  panel: "#A8A076",
  panelOpacity: 0.72,
  ink: "#282A1C",
  priceColor: "#282A1C",
  rule: "#F8F7F2",
  footerBar: "#AEA68A",
  footerText: "#F7F5EE",
  headingFont: "",
  bodyFont: "",
};

type Palette = typeof DEFAULT_PALETTE;

export type ModernHouseContent = {
  format: AdStudioFormat;
  topLabel: string;
  headline: string; // uppercased into the MODERN / HOUSE / FOR SALE block (last line bold)
  priceLabel: string;
  price: string;
  footer: { website: string; phone: string; handle: string };
  heroPhoto?: string; // data: URL or /public path
  stripPhotos?: string[]; // up to 3; falls back to hero
  palette?: Partial<Palette>;
};

function esc(value: string): string {
  return (value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fontStack(family: string | undefined, fallback: string): string {
  return family ? `${family}, ${fallback}` : fallback;
}

function wrapUpper(value: string, maxChars: number): string[] {
  const words = (value || "").toUpperCase().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function icon(kind: string, x: number, y: number, s: number, col: string): string {
  if (kind === "phone") {
    return `<rect x="${x + s * 0.26}" y="${y}" width="${s * 0.48}" height="${s}" rx="3" fill="none" stroke="${col}" stroke-width="2"/><line x1="${x + s * 0.4}" y1="${y + s * 0.84}" x2="${x + s * 0.6}" y2="${y + s * 0.84}" stroke="${col}" stroke-width="2"/>`;
  }
  if (kind === "insta") {
    return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="6" fill="none" stroke="${col}" stroke-width="2"/><circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s * 0.22}" fill="none" stroke="${col}" stroke-width="2"/><circle cx="${x + s * 0.78}" cy="${y + s * 0.22}" r="1.8" fill="${col}"/>`;
  }
  // globe
  return `<g fill="none" stroke="${col}" stroke-width="2"><circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}"/><ellipse cx="${x + s / 2}" cy="${y + s / 2}" rx="${s / 4}" ry="${s / 2}"/><line x1="${x}" y1="${y + s / 2}" x2="${x + s}" y2="${y + s / 2}"/></g>`;
}

export function renderModernHouseForSaleSvg(content: ModernHouseContent): string {
  const { width: W, height: H } = CANVAS[content.format] ?? CANVAS["9:16"];
  const p: Palette = { ...DEFAULT_PALETTE, ...(content.palette ?? {}) };
  const headFont = fontStack(p.headingFont, "Inter, Arial, sans-serif");
  const parts: string[] = [];

  // background
  parts.push(`<rect width="${W}" height="${H}" fill="${p.bg}"/>`);

  // hero photo (full width) + translucent olive panel (inset)
  const heroY = 204;
  const heroH = 990;
  if (content.heroPhoto) {
    parts.push(`<image x="0" y="${heroY}" width="${W}" height="${heroH}" href="${esc(content.heroPhoto)}" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    parts.push(`<rect x="0" y="${heroY}" width="${W}" height="${heroH}" fill="#C9C3B4"/>`);
  }
  parts.push(`<rect x="143" y="215" width="425" height="978" fill="${p.panel}" fill-opacity="${p.panelOpacity}"/>`);

  // top label
  parts.push(`<text x="${W / 2}" y="150" text-anchor="middle" font-family="${esc(headFont)}" font-size="30" letter-spacing="14" fill="${p.ink}">${esc(content.topLabel)}</text>`);

  // headline block (uppercase; last line bold)
  const LX = 182;
  const lines = wrapUpper(content.headline, 8).slice(0, 3);
  const lineH = 72;
  const lastBaseline = 900;
  lines.forEach((ln, i) => {
    const baseline = lastBaseline - (lines.length - 1 - i) * lineH;
    const weight = i === lines.length - 1 ? 800 : 400;
    parts.push(`<text x="${LX}" y="${baseline}" font-family="${esc(headFont)}" font-size="64" font-weight="${weight}" fill="${p.ink}">${esc(ln)}</text>`);
  });

  // rule + price
  parts.push(`<rect x="${LX}" y="934" width="150" height="5" fill="${p.rule}"/>`);
  parts.push(`<text x="${LX}" y="982" font-family="${esc(headFont)}" font-size="23" letter-spacing="3" fill="${p.ink}">${esc(content.priceLabel)}</text>`);
  parts.push(`<text x="${LX}" y="1030" font-family="${esc(headFont)}" font-size="46" font-weight="800" fill="${p.priceColor}">${esc(content.price)}</text>`);

  // 3 portrait strip frames (middle larger / staggered)
  const frames: Array<[number, number, number, number]> = [
    [140, 1228, 262, 472],
    [436, 1170, 262, 588],
    [733, 1228, 263, 472],
  ];
  const strip = content.stripPhotos && content.stripPhotos.length
    ? content.stripPhotos
    : (content.heroPhoto ? [content.heroPhoto, content.heroPhoto, content.heroPhoto] : []);
  frames.forEach(([x, y, w, h], i) => {
    const src = strip[i] ?? strip[strip.length - 1];
    if (src) {
      parts.push(`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${esc(src)}" preserveAspectRatio="xMidYMid slice"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#C9C3B4"/>`);
    }
  });

  // footer bar with light text + icons
  const FBY = 1840;
  parts.push(`<rect x="0" y="${FBY}" width="${W}" height="${H - FBY}" fill="${p.footerBar}"/>`);
  const seg = W / 3;
  const ty = FBY + 50;
  const items: Array<{ icon: string; text: string }> = [
    { icon: "globe", text: content.footer.website },
    { icon: "phone", text: content.footer.phone },
    { icon: "insta", text: content.footer.handle },
  ];
  items.forEach((it, i) => {
    const ix = seg * i + 40;
    parts.push(icon(it.icon, ix, ty - 18, 22, p.footerText));
    parts.push(`<text x="${ix + 34}" y="${ty}" font-family="${esc(headFont)}" font-size="22" fill="${p.footerText}">${esc(it.text)}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.6;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function paletteFromBrandKit(brandKit: AdStudioBrandKit): Partial<Palette> {
  const primary = brandKit.colours.primary || DEFAULT_PALETTE.footerBar;
  const accent = brandKit.colours.accent || DEFAULT_PALETTE.priceColor;
  return {
    // keep the template's cream/olive structure for legibility + identity,
    // but let the brand show through on the footer bar, price accent and fonts.
    footerBar: primary,
    footerText: hexLuminance(primary) < 0.55 ? "#FFFFFF" : "#1D1D17",
    priceColor: accent,
    headingFont: brandKit.typography.headingFont || "",
    bodyFont: brandKit.typography.bodyFont || "",
  };
}

function websiteFromBrand(brandKit: AdStudioBrandKit): string {
  const url = brandKit.source?.url || "";
  const cleaned = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return (cleaned || brandKit.identity.businessName).toUpperCase();
}

export function renderModernHouseForSaleCreative(input: {
  format: AdStudioFormat;
  brandKit: AdStudioBrandKit;
  headline: string;
  subheadline?: string;
  offer?: string;
  cta?: string;
  photoDataUrl?: string;
  stripPhotos?: string[];
  creativeId: string;
  campaignId: string;
  variantId: string;
}): AdStudioCreative {
  const { width, height } = CANVAS[input.format] ?? CANVAS["9:16"];
  const previewSvg = renderModernHouseForSaleSvg({
    format: input.format,
    topLabel: "PROPERTY FOR SALE",
    headline: input.headline || "Modern House For Sale",
    priceLabel: "PRICE STARTS AT",
    price: input.offer || input.subheadline || "",
    footer: {
      website: websiteFromBrand(input.brandKit),
      phone: input.brandKit.contact.phone ?? "",
      handle: input.brandKit.contact.socialLinks[0] ?? (input.brandKit.identity.tradingName || input.brandKit.identity.businessName),
    },
    heroPhoto: input.photoDataUrl,
    stripPhotos: input.stripPhotos,
    palette: paletteFromBrandKit(input.brandKit),
  });

  return {
    creativeId: input.creativeId,
    campaignId: input.campaignId,
    variantId: input.variantId,
    format: input.format,
    source: "template_composite",
    canvas: {
      width,
      height,
      backgroundAssetId: null,
      objects: [],
      composition: {
        id: `standalone:${ID}`,
        copy: {
          brand: input.brandKit.identity.tradingName || input.brandKit.identity.businessName,
          eyebrow: "PROPERTY FOR SALE",
          headline: input.headline,
          subhead: input.subheadline ?? input.offer ?? "",
          cta: input.cta ?? "",
        },
        paletteSeed: { primary: input.brandKit.colours.primary, accent: input.brandKit.colours.accent },
        fontSeed: { headingFont: input.brandKit.typography.headingFont, bodyFont: input.brandKit.typography.bodyFont },
      },
    },
    safeZones: { metaStory: input.format === "9:16", googleDemandGen: true },
    previewSvg,
  };
}

export const modernHouseForSaleTemplate: AdStudioTemplate = {
  id: ID,
  templateKey: ID,
  name: "Modern House For Sale",
  goal: "seller_leads",
  offerId: "listing_inquiries",
  imageBriefId: "IMG-STANDALONE-MODERN-HOUSE",
  promptHint:
    "Standalone clone of reference meta_023: cream card, translucent olive panel carrying MODERN HOUSE FOR SALE + price, three portrait property photos, and an olive footer bar with website/phone/handle.",
  source: "operator",
  status: "approved",
  sampleCopy: {
    headline: "Modern House For Sale",
    primaryText: "A modern house is now on the market for buyers wanting style, comfort and convenience.",
    description: "Standalone listing template measured from the uploaded reference sample.",
    cta: "Enquire now",
  },
  sampleStyle: {
    version: "template-samples-v1",
    propertyAge: "new_build",
    priceFeel: "mid_market_family",
    visualStyle: "polished_meta_ad",
    people: "none",
    copyDensity: "headline_overlay",
    tone: "soft_organic",
    sampleSuburb: "Victoria Park",
    sampleState: "WA",
    agencyName: "Blockwise Realty",
    agentName: "Leo Romano",
    address: "15 Albany Highway, Victoria Park",
    propertyDetail: "modern house for sale",
    resultDetail: "buyer enquiry lead",
    sampleCardImagePath: `adstudio-samples/standalone/${ID}.png`,
  },
  sampleCardImageUrl: `/adstudio-samples/standalone/${ID}.png?v=${VERSION}`,
  evidenceScore: 99,
  winnerRationale: "Standalone measured clone of reference meta_023 (9:16 stories): inset olive panel, portrait photo strip, filled footer bar.",
  complianceNote: "Editable listing template; photo, headline, price and contact details are all replaceable.",
  exemplars: ["Reference sample meta_023 from the uploaded board."],
};

export const modernHouseForSaleSample = {
  heroPhoto: "au-modern-coastal.png",
  stripPhotos: ["au-coastal-luxury.jpg", "au-urban-townhouse.png", "au-character-cottage.jpg"],
  content: {
    topLabel: "PROPERTY FOR SALE",
    headline: "Modern House For Sale",
    priceLabel: "PRICE STARTS AT",
    price: "$ 1,500,000",
    footer: { website: "REALLYGREATSITE.COM", phone: "+123-456-7890", handle: "@reallygreatsite" },
  },
};
