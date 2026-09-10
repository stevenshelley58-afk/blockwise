import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdTemplate } from "../../../packages/ad-template-contract/src/types.ts";
import { renderPlacement, TextPreflightError } from "../../../packages/ad-template-renderer/src/renderer.ts";
import type { BrandPackColours } from "../adstudio/brand-colours.ts";
import { brandPackColoursToRoleMap, resolveBrandColourMap } from "../adstudio/brand-colours.ts";
import { extractBrandKitFromWebsite } from "../adstudio/brand-extraction.ts";
import { normalizeAndValidateExtractionUrl } from "../adstudio/extraction-url.ts";
import { deterministicUuid } from "../adstudio/id.ts";
import { getTemplate, listTemplates, type TemplateLeadType, type TemplateSummary } from "../adstudio/pack-gallery.ts";
import { loadTemplateAssets } from "../adstudio/template-review.ts";
import type { GapConcept } from "../research/suburb-report-insights.ts";
import {
  buildAuditTextValues,
  placeholderTextValues,
  resolveAngleCopy,
  type AuditAngleCopy,
  type AuditCopyContext,
} from "./audit-ad-copy.ts";

// ---------------------------------------------------------------------------
// Audit funnel ad engine.
//
// Given an agency (website or name) and a postcode, produce three finished ad
// creatives: our own reviewed templates, recoloured with the agency's Brand
// Pack, carrying one of their real listing photos where we can find one, and
// written against the angle that is missing from their local ad market.
//
// Everything is anonymous-safe: brand extraction is a pure function of public
// HTML, and the rendered previews are stored under a stable id and served
// through a route that only streams that id's own images. Nothing here needs a
// workspace, so a visitor can see finished ads before they sign up.
//
// The engine is deliberately transport-free so it can be lifted behind the
// Frank template-factory service without changing its callers.
// ---------------------------------------------------------------------------

export const AUDIT_AD_COUNT = 3;
const PREVIEW_BUCKET = "workspace-artifacts";
/** Scraped Meta Ad Library creatives. Private bucket; read with the service client. */
const CREATIVE_BUCKET = "research-ad-creatives";
const CARD_TABLE = "customer_ad_radar_cards";
const HTML_TIMEOUT_MS = 12_000;
const HTML_MAX_BYTES = 1_000_000;
const IMAGE_TIMEOUT_MS = 10_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const LISTING_SCAN_LIMIT = 40;
/** More candidates than ads: some archived creatives are missing or unreadable. */
const LISTING_CANDIDATES = 8;
/** Archived thumbnails are useless in a 1080px creative; skip them by size. */
const MIN_LISTING_BYTES = 15_000;

export type AuditAgencyBrand = {
  businessName: string;
  colours: BrandPackColours | null;
  websiteUrl: string | null;
  websiteHost: string | null;
  phone: string | null;
  source: "website" | "name_only";
};

export type AuditAdPreview = {
  index: number;
  templateId: string;
  templateTitle: string;
  angleKey: string;
  angleLabel: string;
  rationale: string;
  headline: string;
  body: string;
  cta: string;
  previewUrl: string;
  usedListingPhoto: boolean;
};

export type AuditAdBundle = {
  auditId: string;
  postcode: string;
  suburb: string;
  businessName: string;
  website: string | null;
  brandSource: AuditAgencyBrand["source"];
  colours: BrandPackColours | null;
  listingPhotoCount: number;
  ads: AuditAdPreview[];
};

export type AuditAdManifestAd = {
  templateId: string;
  angleKey: string;
  angleLabel: string;
  rationale: string;
  copy: AuditAngleCopy;
  listingPhoto: ListingPhoto | null;
};

export type AuditAdManifest = {
  auditId: string;
  createdAt: string;
  postcode: string;
  suburb: string;
  businessName: string;
  websiteUrl: string | null;
  phone: string | null;
  colours: BrandPackColours | null;
  ads: AuditAdManifestAd[];
};

export type GenerateAuditAdsInput = {
  website: string | null;
  name: string | null;
  postcode: string;
  suburb: string | null;
  concepts: GapConcept[];
};

// ---------------------------------------------------------------------------
// Agency resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a brand from a public website. Brand extraction is a pure function
 * of the HTML, so it runs for visitors who have no workspace yet.
 */
export async function resolveAgencyBrand(input: {
  website: string | null;
  name: string | null;
}): Promise<AuditAgencyBrand> {
  const fallbackName = (input.name ?? "").trim();

  if (!input.website) {
    return {
      businessName: fallbackName || "Your agency",
      colours: null,
      websiteUrl: null,
      websiteHost: null,
      phone: null,
      source: "name_only",
    };
  }

  const validated = normalizeAndValidateExtractionUrl(input.website);
  if (!validated.ok) {
    return {
      businessName: fallbackName || hostToBusinessName(input.website),
      colours: null,
      websiteUrl: null,
      websiteHost: hostOf(input.website),
      phone: null,
      source: "name_only",
    };
  }

  const html = await fetchText(validated.url, /text\/html|application\/xhtml\+xml/i);
  if (!html) {
    return {
      businessName: fallbackName || hostToBusinessName(validated.url),
      colours: null,
      websiteUrl: validated.url,
      websiteHost: hostOf(validated.url),
      phone: null,
      source: "name_only",
    };
  }

  const stylesheetTextByUrl = await fetchStylesheets(validated.url, html);
  const kit = extractBrandKitFromWebsite({
    workspaceId: "public-audit",
    websiteUrl: validated.url,
    marketCountry: "AU",
    marketRegion: "WA",
    htmlByUrl: { [validated.url]: html },
    stylesheetTextByUrl,
  });

  return {
    businessName: fallbackName || kit.identity.businessName || hostToBusinessName(validated.url),
    colours: {
      primary: kit.colours.primary,
      secondary: kit.colours.secondary,
      accent: kit.colours.accent,
      background: kit.colours.background,
      text: kit.colours.text,
    },
    websiteUrl: validated.url,
    websiteHost: hostOf(validated.url),
    phone: extractPhone(html),
    source: "website",
  };
}

// ---------------------------------------------------------------------------
// Listing photos
// ---------------------------------------------------------------------------

export type ListingPhoto = {
  /** Stored creative in the research bucket. Preferred: always readable. */
  storagePath?: string | null;
  /** Scraped remote URL. Blocked by some CDNs, so treated as a fallback. */
  url?: string | null;
};

/**
 * Find the agency's own property photos from scraped Meta Ad Library cards.
 * Returns up to three distinct creatives. A miss is normal — the caller falls
 * back to the template's own photography rather than failing the funnel.
 */
export async function findListingPhotos(
  service: SupabaseClient,
  input: { businessName: string; websiteHost: string | null },
): Promise<ListingPhoto[]> {
  const name = likeTerm(input.businessName);
  const host = input.websiteHost ? likeTerm(input.websiteHost) : "";
  if (!name && !host) return [];

  let rows = await queryCards(service, name);
  if (!rows || rows.length === 0) rows = await queryCards(service, host, "destination_url");
  if (!rows) return [];

  // Only creatives we archived are usable: the scraped CDN URLs are blocked to
  // server-side fetches and are usually 60x60 thumbnails anyway.
  const photos: ListingPhoto[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const path = row.image_storage_path;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    photos.push({ storagePath: path });
    if (photos.length >= LISTING_CANDIDATES) break;
  }
  return photos;
}

type CardRow = { primary_image_url: string | null; image_storage_path: string | null };

async function queryCards(
  service: SupabaseClient,
  term: string,
  column = "page_name",
): Promise<CardRow[] | null> {
  if (!term) return null;
  try {
    const { data, error } = await service
      .from(CARD_TABLE)
      .select("primary_image_url, image_storage_path")
      .ilike(column, `%${term}%`)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(LISTING_SCAN_LIMIT);
    if (error || !data) return null;
    return data as CardRow[];
  } catch {
    return null;
  }
}

/** Read one creative, preferring the stored copy over the scraped CDN URL. */
export async function loadListingPhoto(
  service: SupabaseClient,
  photo: ListingPhoto,
): Promise<Buffer | null> {
  if (photo.storagePath) {
    try {
      const { data, error } = await service.storage.from(CREATIVE_BUCKET).download(photo.storagePath);
      if (!error && data) {
        const bytes = Buffer.from(await data.arrayBuffer());
        if (bytes.byteLength >= MIN_LISTING_BYTES && bytes.byteLength <= IMAGE_MAX_BYTES) return bytes;
      }
    } catch {
      /* fall through to the scraped URL */
    }
  }
  return photo.url ? fetchImageBuffer(photo.url) : null;
}

// ---------------------------------------------------------------------------
// Template selection
// ---------------------------------------------------------------------------

const LEAD_TYPE_BY_ANGLE: Record<string, TemplateLeadType[]> = {
  "appraisal or valuation": ["appraisal", "seller"],
  "just sold or results": ["market_update", "seller"],
  "seller guide or market update": ["market_update", "seller"],
  "open home": ["open_home", "buyer"],
  "single listing": ["seller", "buyer"],
  "agent or agency brand": ["other", "seller"],
};

/**
 * Choose one distinct template per concept, preferring a template whose lead
 * type matches the angle. Falls back to any unused template so we always
 * return three creatives.
 */
export function pickTemplateIds(
  summaries: TemplateSummary[],
  concepts: GapConcept[],
  count = AUDIT_AD_COUNT,
): string[] {
  const remaining = summaries.slice();
  const chosen: string[] = [];

  const take = (predicate: (summary: TemplateSummary) => boolean): string | null => {
    const index = remaining.findIndex(predicate);
    if (index < 0) return null;
    const [summary] = remaining.splice(index, 1);
    chosen.push(summary.templateId);
    return summary.templateId;
  };

  for (const concept of concepts.slice(0, count)) {
    const preferred = LEAD_TYPE_BY_ANGLE[concept.key] ?? [];
    let picked = false;
    for (const leadType of preferred) {
      if (take((summary) => summary.leadType === leadType)) {
        picked = true;
        break;
      }
    }
    if (!picked) take(() => true);
  }

  while (chosen.length < count && remaining.length > 0) take(() => true);
  return chosen;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export type RenderedAuditAd = { png: Buffer; usedListingPhoto: boolean };

export async function renderAuditAd(
  service: SupabaseClient,
  input: {
    template: AdTemplate;
    copy: AuditAngleCopy;
    context: AuditCopyContext;
    colours: BrandPackColours | null;
    listingPhoto: Buffer | null;
    dateAngle?: boolean;
  },
): Promise<RenderedAuditAd> {
  const assets = await loadTemplateAssets(input.template, service);
  const imageValues: Record<string, Buffer> = { ...assets };
  for (const slot of input.template.imageInputs) {
    if (slot.defaultAssetKey && assets[slot.defaultAssetKey]) {
      imageValues[slot.key] = assets[slot.defaultAssetKey]!;
    }
  }

  let usedListingPhoto = false;
  if (input.listingPhoto) {
    const hero =
      input.template.imageInputs.find((slot) => /hero|main|feature|primary/i.test(slot.key)) ??
      input.template.imageInputs[0];
    if (hero) {
      imageValues[hero.key] = input.listingPhoto;
      usedListingPhoto = true;
    }
  }

  const fontValues = Object.fromEntries(
    input.template.fonts.flatMap((font) => {
      const match = Object.entries(input.template.assets).find(([, declaration]) => declaration.fileName === font.file);
      return match && assets[match[0]] ? [[font.file, assets[match[0]]!] as const] : [];
    }),
  );

  const colourMap = resolveBrandColourMap(
    input.template.semanticColours,
    brandPackColoursToRoleMap(input.colours),
  );

  const renderInput = {
    template: input.template,
    imageValues,
    textValues: {} as Record<string, string>,
    colourMap,
    fontValues,
  };

  // Generated copy is trimmed to the template's own limits, but a template can
  // still refuse a value that will not fit its box. A reviewed template always
  // renders with its own placeholders, so retry with those rather than failing.
  try {
    renderInput.textValues = buildAuditTextValues(input.template, input.copy, input.context, { dateAngle: input.dateAngle });
    const rendered = await renderPlacement(renderInput, "feed");
    return { png: rendered.png, usedListingPhoto };
  } catch (error) {
    if (!(error instanceof TextPreflightError)) throw error;
    renderInput.textValues = placeholderTextValues(input.template);
    const rendered = await renderPlacement(renderInput, "feed");
    return { png: rendered.png, usedListingPhoto };
  }
}

// ---------------------------------------------------------------------------
// Preview persistence
// ---------------------------------------------------------------------------

export function auditPreviewPath(auditId: string, index: number): string {
  return ["audit-previews", auditId, `ad-${index}.png`].join("/");
}

export function auditManifestPath(auditId: string): string {
  return ["audit-previews", auditId, "manifest.json"].join("/");
}

export function auditPreviewUrl(auditId: string, index: number): string {
  return `/api/audit/ads/${encodeURIComponent(auditId)}/${index}`;
}

export function auditIdFor(input: { businessName: string; postcode: string }): string {
  return deterministicUuid(`audit:${slug(input.businessName)}:${input.postcode}`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Build the three creatives and store them so a preview route can stream them. */
export async function generateAuditAds(
  service: SupabaseClient,
  input: GenerateAuditAdsInput,
): Promise<AuditAdBundle> {
  const suburb = input.suburb?.trim() || input.postcode;
  const brand = await resolveAgencyBrand({ website: input.website, name: input.name });
  const context: AuditCopyContext = {
    businessName: brand.businessName,
    suburb,
    postcode: input.postcode,
    websiteHost: brand.websiteHost,
    phone: brand.phone,
  };

  const [photos, summaries] = await Promise.all([
    findListingPhotos(service, { businessName: brand.businessName, websiteHost: brand.websiteHost }),
    listTemplates(service),
  ]);

  if (summaries.length === 0) throw new Error("No active templates are available.");

  const concepts = padConcepts(input.concepts);
  const templateIds = pickTemplateIds(summaries, concepts);
  if (templateIds.length < AUDIT_AD_COUNT) {
    throw new Error("Three active templates are required to build an audit.");
  }

  const auditId = auditIdFor({ businessName: brand.businessName, postcode: input.postcode });
  const manifestAds: AuditAdManifestAd[] = [];
  const ads: AuditAdPreview[] = [];

  // Load the listing photos up front and skip the ones we cannot read, so an
  // ad never loses its slot to a creative that turned out to be unusable.
  const loadedPhotos: ListingPhoto[] = [];
  const loadedBytes: Buffer[] = [];
  for (const photo of photos) {
    if (loadedBytes.length >= AUDIT_AD_COUNT) break;
    const bytes = await loadListingPhoto(service, photo);
    if (!bytes) continue;
    loadedPhotos.push(photo);
    loadedBytes.push(bytes);
  }

  for (let index = 0; index < templateIds.length; index += 1) {
    const concept = concepts[index]!;
    const template = await getTemplate(service, templateIds[index]!);
    if (!template) continue;
    const slot = ads.length;

    const photo = loadedPhotos[index] ?? null;
    const bytes = loadedBytes[index] ?? null;

    const copy = resolveAngleCopy(concept, context);
    let rendered: RenderedAuditAd;
    try {
      rendered = await renderAuditAd(service, {
        template,
        copy,
        context,
        colours: brand.colours,
        listingPhoto: bytes,
        dateAngle: concept.key === "open home" || concept.key === "single listing",
      });
    } catch {
      continue;
    }

    await service.storage
      .from(PREVIEW_BUCKET)
      .upload(auditPreviewPath(auditId, slot), rendered.png, { contentType: "image/png", upsert: true });

    manifestAds.push({
      templateId: template.templateId,
      angleKey: concept.key,
      angleLabel: concept.label,
      rationale: concept.rationale,
      copy,
      listingPhoto: rendered.usedListingPhoto ? photo : null,
    });
    ads.push({
      index: slot,
      templateId: template.templateId,
      templateTitle: template.metadata.title,
      angleKey: concept.key,
      angleLabel: concept.label,
      rationale: concept.rationale,
      headline: copy.headline,
      body: copy.body,
      cta: copy.cta,
      previewUrl: auditPreviewUrl(auditId, slot),
      usedListingPhoto: rendered.usedListingPhoto,
    });
  }

  if (ads.length === 0) throw new Error("The audit could not be generated for this agency.");

  const manifest: AuditAdManifest = {
    auditId,
    createdAt: new Date().toISOString(),
    postcode: input.postcode,
    suburb,
    businessName: brand.businessName,
    websiteUrl: brand.websiteUrl,
    phone: brand.phone,
    colours: brand.colours,
    ads: manifestAds,
  };
  await service.storage
    .from(PREVIEW_BUCKET)
    .upload(auditManifestPath(auditId), Buffer.from(JSON.stringify(manifest), "utf8"), {
      contentType: "application/json",
      upsert: true,
    });

  return {
    auditId,
    postcode: input.postcode,
    suburb,
    businessName: brand.businessName,
    website: brand.websiteUrl,
    brandSource: brand.source,
    colours: brand.colours,
    listingPhotoCount: loadedPhotos.length,
    ads,
  };
}

export async function readAuditManifest(
  service: SupabaseClient,
  auditId: string,
): Promise<AuditAdManifest | null> {
  try {
    const { data, error } = await service.storage.from(PREVIEW_BUCKET).download(auditManifestPath(auditId));
    if (error || !data) return null;
    const text = Buffer.from(await data.arrayBuffer()).toString("utf8");
    return JSON.parse(text) as AuditAdManifest;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function padConcepts(concepts: GapConcept[], count = AUDIT_AD_COUNT): GapConcept[] {
  const filled = concepts.slice(0, count);
  const fallbacks: GapConcept[] = [
    {
      key: "appraisal or valuation",
      category: "real estate",
      label: "Appraisal angle",
      headline: "What is your home worth today?",
      body: "A dated local appraisal from an agent who sells here, not an automated estimate.",
      cta: "Get the number",
      rationale: "The most reliable seller-lead angle in a quiet local ad market.",
    },
    {
      key: "just sold or results",
      category: "real estate",
      label: "Results angle",
      headline: "What local homes sold for",
      body: "Recent local sales with the real numbers, not the asking prices.",
      cta: "See the results",
      rationale: "Results proof travels further than a brand message in a crowded area.",
    },
    {
      key: "seller guide or market update",
      category: "real estate",
      label: "Seller guide angle",
      headline: "Thinking of selling?",
      body: "The things that move the price around here, in one short page.",
      cta: "Read the guide",
      rationale: "A guide gives homeowners a reason to raise their hand before they are ready.",
    },
  ];
  while (filled.length < count) filled.push(fallbacks[filled.length % fallbacks.length]!);
  return filled;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "agency";
}

function likeTerm(value: string): string {
  return value.trim().replace(/[%_,()"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

function hostOf(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function hostToBusinessName(value: string): string {
  const host = hostOf(value);
  if (!host) return "Your agency";
  return host
    .split(".")[0]!
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Only ever a phone number published on the agency's own site. */
function extractPhone(html: string): string | null {
  const tel = /href\s*=\s*["']tel:([+0-9\s()-]{8,20})["']/i.exec(html);
  const candidate = tel?.[1] ?? /(?:\+?61|0)[2-478]\s?\d{4}\s?\d{4}/.exec(html)?.[0] ?? null;
  if (!candidate) return null;
  return candidate.trim().replace(/\s+/g, " ").slice(0, 20);
}

async function fetchText(url: string, contentTypePattern: RegExp): Promise<string | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentTypePattern.test(contentType)) return null;
    const reader = response.body?.getReader();
    if (!reader) return (await response.text()).slice(0, HTML_MAX_BYTES);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > HTML_MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function fetchStylesheets(websiteUrl: string, html: string): Promise<Record<string, string>> {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!/\bstylesheet\b/i.test(rel) || !href) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), websiteUrl);
      if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.toString());
    } catch {
      continue;
    }
  }

  const entries = await Promise.all(
    [...urls].slice(0, 3).map(async (url): Promise<[string, string] | null> => {
      try {
        const text = await fetchText(url, /text\/css|text\/plain/i);
        return text ? [url, text] : null;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null));
}

export async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/^image\//i.test(contentType)) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > IMAGE_MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}
