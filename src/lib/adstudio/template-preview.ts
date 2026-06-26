import { svgDataUrl, toWellFormedText } from "./creative/svg-data-url.ts";
import { renderDesignSvg } from "./renderer.ts";
import { resolveTemplateDesignForFormat } from "./template-design.ts";
import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit } from "./types.ts";

function sanitise(value: unknown): string {
  const src = toWellFormedText(String(value ?? ""));
  let out = "";
  for (let i = 0; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    // Mojibake sequences from mis-decoded UTF-8 (e.g. an em-dash that became three bytes).
    if (code === 0x00e2 && src.charCodeAt(i + 1) === 0x20ac) {
      const third = src.charCodeAt(i + 2);
      if (third === 0x201d) { out += "-"; i += 2; continue; }
      if (third === 0x00a6) { out += "..."; i += 2; continue; }
    }
    if (code === 0x00c2 && src.charCodeAt(i + 1) === 0x00b7) { out += "/"; i += 1; continue; }
    // Real punctuation we normalise for the preview.
    if (code === 0x2014) { out += "-"; continue; }
    if (code === 0x2026) { out += "..."; continue; }
    if (code === 0x00b7) { out += "/"; continue; }
    // Strip control characters that would break the SVG/data URL.
    if ((code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
      out += " ";
      continue;
    }
    out += src[i];
  }
  return out
    .replace(/\s+/gu, " ")
    .trim();
}

function safeString(value: unknown, fallback: string): string {
  const s = sanitise(value);
  return s ? s : fallback;
}

/**
 * Render a template preview from the template's own committed TemplateDesign.
 * Templates are standalone mini-projects: missing design data is a product
 * defect, not a reason to fall back to a generic layout.
 */
export function templatePreviewSvg(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  const brandName = safeString(brandKit.identity?.tradingName || brandKit.identity?.businessName, "Your agency");
  const raw = template.sampleCopy;
  const copy = {
    brand: brandName,
    eyebrow: sanitise(template.name),
    headline: safeString(raw?.headline, template.name),
    subhead: safeString(raw?.primaryText ?? raw?.description, template.promptHint),
    cta: safeString(raw?.cta, "Learn more"),
  };

  const design = resolveTemplateDesignForFormat(template, "4:5");
  if (!design) {
    throw new Error(`Template ${template.id} is missing an explicit 4:5 TemplateDesign preview.`);
  }
  return renderDesignSvg(design, {
    text: {
      eyebrow: copy.eyebrow,
      headline: copy.headline,
      subhead: copy.subhead,
      body: copy.subhead,
      cta: copy.cta,
      phone: brandKit.contact.phone ?? "",
      handle: brandName,
    },
  }, brandKit);
}

export function templatePreviewDataUrl(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  // Prefer the rendered original sample card when one exists. These cards are
  // original Blockwise creative (no observed-ad pixels), so they are safe to
  // surface in the picker; otherwise fall back to the neutral on-brand mock.
  const sampleCard = template.sampleCardImageUrl;
  if (typeof sampleCard === "string" && (sampleCard.startsWith("/") || /^https:\/\//u.test(sampleCard))) {
    return sampleCard;
  }
  return svgDataUrl(templatePreviewSvg(template, brandKit));
}
