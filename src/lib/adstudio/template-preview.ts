import { buildComposition } from "./creative/compositions.ts";
import { buildPalette, fontStacks, renderScene } from "./creative/preview-engine.ts";
import { compositionForTemplate, sampleCopyForTemplate } from "./creative/template-composition.ts";
import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit } from "./types.ts";

// Scraped/mined template text can contain lone surrogates and control
// characters. Keep the preview robust — it is rendered as an <img src> data URL
// via encodeURIComponent.
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
 * A clean, on-brand SVG preview of a template, rendered through the shared
 * creative engine — the same composition the real ad uses. Customer colours,
 * fonts and business name, a "your listing photo" area, sample copy and a brand
 * CTA. Never bakes in observed-ad pixels.
 */
export function templatePreviewSvg(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  const palette = buildPalette(brandKit.colours?.primary, brandKit.colours?.accent);
  const stacks = fontStacks(brandKit.typography?.headingFont, brandKit.typography?.bodyFont);
  const brandName = safeString(brandKit.identity?.tradingName || brandKit.identity?.businessName, "Your agency");

  const raw = sampleCopyForTemplate(template, brandName);
  const copy = {
    brand: brandName,
    eyebrow: sanitise(raw.eyebrow),
    headline: sanitise(raw.headline),
    subhead: sanitise(raw.subhead),
    cta: sanitise(raw.cta),
    stat: raw.stat,
    statLabel: raw.statLabel,
    features: raw.features ? raw.features.map((f) => sanitise(f)) : undefined,
  };

  const compositionId = compositionForTemplate(template);
  const scene = buildComposition(compositionId, { width: 1080, height: 1350, palette, stacks, copy, photo: null });
  return renderScene(scene, stacks);
}

export function templatePreviewDataUrl(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  // Prefer the rendered original sample card when one exists. These cards are
  // original Blockwise creative (no observed-ad pixels), so they are safe to
  // surface in the picker; otherwise fall back to the neutral on-brand mock.
  const sampleCard = template.sampleCardImageUrl;
  if (typeof sampleCard === "string" && /^https:\/\//u.test(sampleCard)) {
    return sampleCard;
  }
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
