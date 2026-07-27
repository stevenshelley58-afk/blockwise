import { deterministicUuid } from "./id.ts";
import type { AdStudioBrandKit, AdStudioReviewStatus } from "./types.ts";

export type ExtractBrandKitInput = {
  workspaceId: string;
  websiteUrl: string;
  marketCountry: "AU" | "US";
  marketRegion?: string | null;
  htmlByUrl: Record<string, string>;
  stylesheetTextByUrl?: Record<string, string>;
};

export type BrandKitReviewPatch = {
  reviewStatus?: AdStudioReviewStatus;
  lockedFields?: string[];
};

const DEFAULT_COLOURS = {
  primary: "#123E75",
  secondary: "#F1F5F9",
  accent: "#31C46F",
  background: "#FFFFFF",
  text: "#131B2E",
};

const COMMON_SYSTEM_FONTS = new Set([
  "system-ui",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Arial",
  "sans-serif",
  "serif",
  "ui-sans-serif",
]);

export function extractBrandKitFromWebsite(input: ExtractBrandKitInput): AdStudioBrandKit {
  const normalizedUrl = normalizeUrl(input.websiteUrl);
  const entries = Object.entries(input.htmlByUrl);
  const homepageHtml = input.htmlByUrl[normalizedUrl] ?? entries[0]?.[1] ?? "";
  const pagesScanned = entries.map(([url]) => normalizeUrl(url));
  const title = extractTagText(homepageHtml, "title");
  const siteName =
    extractMeta(homepageHtml, "og:site_name") ??
    extractMeta(homepageHtml, "application-name") ??
    cleanBusinessName(title) ??
    hostToBusinessName(normalizedUrl);
  const cssText = [extractCssText(homepageHtml), ...Object.values(input.stylesheetTextByUrl ?? {})].filter(Boolean).join("\n");
  const colours = extractColours(cssText);
  const typography = extractTypography(cssText);
  const logo = extractLogoUrl(homepageHtml, normalizedUrl);
  const favicon = extractLinkUrl(homepageHtml, normalizedUrl, ["icon", "shortcut icon", "apple-touch-icon"]);
  const privacyPolicyUrl = extractAnchorUrl(homepageHtml, normalizedUrl, /privacy/i);
  const termsUrl = extractAnchorUrl(homepageHtml, normalizedUrl, /terms|conditions/i);
  const socialLinks = extractSocialLinks(homepageHtml);

  return {
    brandKitId: deterministicUuid(`${input.workspaceId}:${normalizedUrl}`),
    workspaceId: input.workspaceId,
    source: {
      type: "website",
      url: normalizedUrl,
      lastExtractedAt: new Date().toISOString(),
      pagesScanned,
    },
    identity: {
      businessName: siteName,
      tradingName: siteName,
      marketCountry: input.marketCountry,
      marketRegion: input.marketRegion ?? "WA",
      licenceText: extractLicenceText(homepageHtml),
    },
    logos: {
      primaryLogoUrl: logo,
      darkLogoUrl: null,
      lightLogoUrl: null,
      faviconUrl: favicon,
    },
    colours: {
      primary: colours.primary ?? DEFAULT_COLOURS.primary,
      secondary: colours.secondary ?? DEFAULT_COLOURS.secondary,
      accent: colours.accent ?? DEFAULT_COLOURS.accent,
      background: colours.background ?? DEFAULT_COLOURS.background,
      text: colours.text ?? DEFAULT_COLOURS.text,
      confidence: {
        primary: colours.primary ? 0.88 : 0.52,
        secondary: colours.secondary ? 0.74 : 0.48,
      },
    },
    typography: {
      headingFont: typography.heading,
      bodyFont: typography.body,
      fallbackHeading: typography.headingFallback,
      fallbackBody: "sans-serif",
    },
    visualStyle: {
      styleTags: inferStyleTags(homepageHtml, colours.ranked),
      imageTreatment: "Bright local property imagery with clean brand typography.",
      layoutDensity: "low",
      cornerRadius: cssText.includes("border-radius: 8px") ? "small" : "medium",
    },
    tone: {
      voice: inferVoice(homepageHtml),
      avoid: ["hype", "cheap urgency", "unsupported guarantees"],
      preferredPhrases: extractPreferredPhrases(homepageHtml),
      sampleCopy: extractSampleCopy(homepageHtml),
    },
    assets: {
      headshots: extractImageUrls(homepageHtml, normalizedUrl, /headshot|agent|profile/i),
      officeImages: extractImageUrls(homepageHtml, normalizedUrl, /office|team/i),
      listingImages: extractImageUrls(homepageHtml, normalizedUrl, /listing|property|home|house/i),
      socialProofImages: extractImageUrls(homepageHtml, normalizedUrl, /sold|review|testimonial/i),
    },
    contact: {
      phone: extractPhone(homepageHtml),
      email: extractEmail(homepageHtml),
      address: extractAddress(homepageHtml),
      socialLinks,
    },
    compliance: {
      disclaimers: extractDisclaimers(homepageHtml),
      privacyPolicyUrl,
      termsUrl,
    },
    reviewStatus: "pending_user_review",
    lockedFields: [],
  };
}

export function mergeBrandKitReview(
  existing: AdStudioBrandKit,
  next: AdStudioBrandKit,
  patch: BrandKitReviewPatch = {},
): AdStudioBrandKit {
  const lockedFields = patch.lockedFields ?? existing.lockedFields;
  const merged = structuredClone(next) as AdStudioBrandKit;

  for (const path of lockedFields) {
    const existingValue = getPath(existing, path);

    if (existingValue !== undefined) {
      setPath(merged, path, existingValue);
    }
  }

  return {
    ...merged,
    reviewStatus: patch.reviewStatus ?? next.reviewStatus,
    lockedFields,
  };
}

function normalizeUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function absoluteUrl(base: string, value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(decodeHtml(value), base).toString();
  } catch {
    return null;
  }
}

function extractTagText(html: string, tagName: string): string | null {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1] ? decodeHtml(stripTags(match[1]).trim()) : null;
}

function extractMeta(html: string, name: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = extractAttributes(match[0]);
    if ((attributes.property ?? attributes.name)?.toLowerCase() === name.toLowerCase() && attributes.content) {
      return decodeHtml(attributes.content).trim();
    }
  }

  return null;
}

function extractCssText(html: string): string {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
}

function extractColours(cssText: string): {
  primary: string | null;
  secondary: string | null;
  accent: string | null;
  background: string | null;
  text: string | null;
  ranked: string[];
} {
  const counts = new Map<string, number>();

  for (const match of cssText.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    const colour = normalizeHex(match[0]);
    if (!colour || colour === "#FFFFFF" || colour === "#000000") {
      continue;
    }
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([colour]) => colour);
  const primary = extractNamedColour(cssText, ["primary", "brand-primary"]) ?? ranked[0] ?? null;
  const secondary = extractNamedColour(cssText, ["secondary", "brand-secondary"]) ?? ranked.find((colour) => colour !== primary) ?? null;
  const background = extractNamedColour(cssText, ["background", "page-background", "surface"]);
  const text = extractNamedColour(cssText, ["text", "foreground", "body-text"]);
  const accent =
    extractNamedColour(cssText, ["accent", "brand-accent"]) ??
    ranked.find((colour) => !new Set([primary, secondary, background, text]).has(colour)) ??
    null;

  return { primary, secondary, accent, background, text, ranked: ranked.slice(0, 8) };
}

function extractNamedColour(cssText: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = cssText.match(new RegExp(`--(?:color-)?${escaped}\\s*:\\s*(#[0-9a-f]{3,8})\\b`, "i"));
    const colour = normalizeHex(match?.[1] ?? "");
    if (colour) return colour;
  }
  return null;
}

function normalizeHex(value: string): string | null {
  const raw = value.toUpperCase();

  if (/^#[0-9A-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }

  if (/^#[0-9A-F]{6}$/.test(raw)) {
    return raw;
  }

  if (/^#[0-9A-F]{8}$/.test(raw)) {
    return raw.slice(0, 7);
  }

  return null;
}

function extractTypography(cssText: string): { heading: string; body: string; headingFallback: "serif" | "sans-serif" } {
  let heading: string | null = null;
  let body: string | null = null;
  let headingFallback: "serif" | "sans-serif" | null = null;
  const discovered: string[] = [];

  for (const rule of cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1] ?? "";
    const declaration = rule[2]?.match(/font-family\s*:\s*([^;}]+)/i)?.[1];
    const font = declaration ? firstUsefulFont(declaration) : null;
    if (!font) continue;
    discovered.push(font);
    if (!body && /(^|[\s,>+~])(?:html|body)(?=$|[\s,.#:[>+~])/i.test(selector)) body = font;
    if (!heading && /(^|[\s,>+~])h[1-6](?=$|[\s,.#:[>+~])/i.test(selector)) {
      heading = font;
      headingFallback = /(?:^|,)\s*serif\s*$/i.test(declaration ?? "") ? "serif" : "sans-serif";
    }
  }

  body ??= discovered[0] ?? "Inter";
  heading ??= discovered.find((font) => font !== body) ?? body;
  return { heading, body, headingFallback: headingFallback ?? (fontLooksSerif(heading) ? "serif" : "sans-serif") };
}

function firstUsefulFont(value: string): string | null {
  const fonts = value
    .split(",")
    .map((font) => font.replace(/["']/g, "").trim())
    .filter(Boolean);

  return fonts.find((font) => !COMMON_SYSTEM_FONTS.has(font)) ?? fonts[0] ?? null;
}

function extractLogoUrl(html: string, baseUrl: string): string | null {
  const imgMatches = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const logoImg = imgMatches.find((tag) => /logo|brand/i.test(tag));
  const src = logoImg?.match(/\bsrc=["']([^"']+)["']/i)?.[1];

  return absoluteUrl(baseUrl, src ?? null) ?? extractLinkUrl(html, baseUrl, ["mask-icon"]);
}

function extractLinkUrl(html: string, baseUrl: string, relCandidates: string[]): string | null {
  for (const rel of relCandidates) {
    const pattern = new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>`, "i");
    const match = html.match(pattern);
    const url = absoluteUrl(baseUrl, match?.[1] ?? null);
    if (url) {
      return url;
    }
  }

  return null;
}

function extractAnchorUrl(html: string, baseUrl: string, labelPattern: RegExp): string | null {
  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  for (const match of matches) {
    if (labelPattern.test(stripTags(match[2] ?? "")) || labelPattern.test(match[1] ?? "")) {
      return absoluteUrl(baseUrl, match[1] ?? null);
    }
  }

  return null;
}

function extractSocialLinks(html: string): string[] {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => decodeHtml(match[1] ?? ""))
    .filter((href) => /facebook|instagram|linkedin|youtube/i.test(href))
    .slice(0, 8);
}

function extractImageUrls(html: string, baseUrl: string, tagPattern: RegExp): string[] {
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .filter((match) => tagPattern.test(match[0]))
    .map((match) => absoluteUrl(baseUrl, match[0].match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? null))
    .filter((url): url is string => Boolean(url))
    .slice(0, 12);
}

function extractPhone(html: string): string | null {
  const tel = html.match(/href=["']tel:([^"']+)["']/i)?.[1];
  const text = tel ?? stripTags(html).match(/(?:\+?61|0)\s?(?:2|3|4|7|8)\s?\d{2,4}\s?\d{3}\s?\d{3}/)?.[0];
  return text ? decodeHtml(text).trim() : null;
}

function extractEmail(html: string): string | null {
  const mailto = html.match(/href=["']mailto:([^"'?]+)[^"']*["']/i)?.[1];
  return mailto ?? stripTags(html).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
}

function extractAddress(html: string): string | null {
  const match = stripTags(html).match(/\b\d{1,5}\s+[A-Z][A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Parade|Pde)\b/);
  return match?.[0] ?? null;
}

function extractLicenceText(html: string): string | null {
  const text = stripTags(html).replace(/\s+/g, " ");
  return text.match(/\b(?:Licence|License|REBA)\s*(?:No\.?|Number)?\s*[:#]?\s*[A-Z0-9 -]{4,24}\b/i)?.[0] ?? null;
}

function extractDisclaimers(html: string): string[] {
  const blockText = [...html.matchAll(/<(p|small|aside)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => decodeHtml(stripTags(match[2] ?? "")).replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length <= 320)
    .join("\n");
  const source = blockText || stripTags(html).replace(/\s+/g, " ");

  return source
    .split(/\n+/)
    .filter((sentence) => /general only|privacy|terms|licensed|licence|disclaimer|not financial advice/i.test(sentence))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && sentence.length <= 320)
    .slice(0, 6);
}

function cleanBusinessName(title: string | null): string | null {
  if (!title) {
    return null;
  }

  return title.split(/[-|•]/)[0]?.trim() || null;
}

function hostToBusinessName(value: string): string {
  const host = new URL(value).hostname.replace(/^www\./, "");
  return host
    .split(".")[0]
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferStyleTags(html: string, colours: string[]): string[] {
  const text = stripTags(html).toLowerCase();
  const tags = new Set<string>();

  if (/premium|luxury|bespoke|executive/.test(text)) tags.add("premium");
  if (/calm|trusted|local|advice/.test(text)) tags.add("professional");
  if (colours.length <= 2) tags.add("minimal");
  if (/family|community|neighbourhood/.test(text)) tags.add("warm");

  return tags.size ? [...tags] : ["professional", "local", "clean"];
}

function inferVoice(html: string): string {
  const text = stripTags(html).toLowerCase();

  if (/premium|luxury|bespoke/.test(text)) {
    return "premium local expert";
  }

  if (/calm|advice|trusted/.test(text)) {
    return "calm local advisor";
  }

  return "professional local expert";
}

function extractPreferredPhrases(html: string): string[] {
  return extractSampleCopy(html)
    .filter((copy) => /local|market|seller|property|advice/i.test(copy))
    .slice(0, 5);
}

function extractSampleCopy(html: string): string[] {
  const copy = [...html.matchAll(/<(?:h1|h2|p)[^>]*>([\s\S]*?)<\/(?:h1|h2|p)>/gi)]
    .map((match) => decodeHtml(stripTags(match[1] ?? "")).replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 12 && value.length <= 240);

  return [...new Set(copy)].slice(0, 8);
}

function fontLooksSerif(font: string): boolean {
  return /serif|times|garamond|georgia/i.test(font);
}

function stripTags(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function extractAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([^\s=<>]+)\s*=\s*(["'])(.*?)\2/g)) {
    const key = match[1]?.toLowerCase();
    if (key) attributes[key] = match[3] ?? "";
  }
  return attributes;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }

    return undefined;
  }, source);
}

function setPath(target: unknown, path: string, value: unknown) {
  const parts = path.split(".");
  let current = target as Record<string, unknown>;

  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts.at(-1) ?? path] = value;
}
