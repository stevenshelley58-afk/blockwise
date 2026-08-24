import { templatePackAnySchema } from "../../../packages/ad-template-pack-contract/src/index.ts";
import type { Layout, TemplatePack } from "../../../packages/ad-template-pack-contract/src/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Read model for imported template packs (ad-template-pack-import migration).
// Packs are built in Frank, imported through the signed import endpoint, and
// stored immutably in ad_template_packs (global — shared by every workspace).
// This module is read-only: it never writes to the import tables.
// ---------------------------------------------------------------------------

export interface ImportedPackSummary {
  packId: string;
  templateId: string;
  name: string;
  version: number;
  importedAt: string;
  imageInputs: number;
  textInputs: number;
  feedLayout: Layout;
  storyLayout: Layout;
  semanticColours: TemplatePack["semanticColours"];
  gallerySampleUrl: string | null;
}

export type GallerySamplePlacement = "feed" | "story";

type PackRow = {
  pack_id: unknown;
  template_id: unknown;
  version: unknown;
  pack_json: unknown;
  created_at: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function readGallerySampleUrl(value: unknown): string | null {
  const raw = record(value);
  const metadataGallery = record(record(raw?.metadata)?.gallerySamples);
  const gallery = metadataGallery ?? record(raw?.gallerySample);
  const provenance = record(raw?.provenance);
  const sample = record(gallery?.feed) ?? record(gallery) ?? record(provenance?.sample);
  const safeFeed = record(record(raw?.safePreviews)?.feed);
  const candidate = sample?.imageSrc ?? sample?.url ?? safeFeed?.url;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

/**
 * Return the immutable asset key declared for a gallery sample.
 *
 * The URL in a Frank pack is provenance only. Customer-facing pages must not
 * render that remote URL directly: the imported bytes live in our private
 * storage and are served through the authenticated same-origin sample route.
 */
export function readGallerySampleAssetKey(
  value: unknown,
  placement: GallerySamplePlacement = "feed",
): string | null {
  const raw = record(value);
  const metadataGallery = record(record(raw?.metadata)?.gallerySamples);
  const sample = record(metadataGallery?.[placement]);
  const key = sample?.assetKey;
  return typeof key === "string" && /^[A-Za-z0-9._-]+$/.test(key) ? key : null;
}

export function gallerySampleProxyUrl(
  packId: string,
  value: unknown,
  placement: GallerySamplePlacement = "feed",
): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(packId) || !readGallerySampleAssetKey(value, placement)) return null;
  return `/api/adstudio/template-packs/${encodeURIComponent(packId)}/sample?placement=${placement}`;
}

/** All active imported packs, newest first. Invalid rows are skipped, never fatal. */
export async function listImportedPacks(
  supabase: SupabaseClient,
): Promise<ImportedPackSummary[]> {
  const { data, error } = await supabase
    .from("ad_template_packs")
    .select("pack_id, template_id, version, pack_json, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const summaries: ImportedPackSummary[] = [];
  for (const row of (data ?? []) as PackRow[]) {
    const pack = parsePackJson(row.pack_json);
    if (!pack) continue;
    summaries.push(summaryFromPack(pack, row));
  }
  return summaries;
}

/** Single pack by pack_id, or null when missing / invalid. */
export async function getImportedPack(
  supabase: SupabaseClient,
  packId: string,
): Promise<TemplatePack | null> {
  const { data, error } = await supabase
    .from("ad_template_packs")
    .select("pack_json")
    .eq("pack_id", packId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return parsePackJson((data as { pack_json: unknown }).pack_json);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summaryFromPack(pack: TemplatePack, row: PackRow): ImportedPackSummary {
  const label = pack.classification?.label?.trim();
  return {
    packId: String(row.pack_id ?? pack.packId),
    templateId: pack.templateId,
    name: (record((pack as unknown as Record<string, unknown>).metadata)?.title as string | undefined) ?? (label && label.length > 0 ? label : pack.templateId),
    version: pack.version,
    importedAt: typeof row.created_at === "string" ? row.created_at : pack.createdAt,
    imageInputs: pack.imageInputs.length,
    textInputs: pack.textInputs.length,
    feedLayout: pack.feedLayout,
    storyLayout: pack.storyLayout,
    semanticColours: { ...pack.semanticColours },
    // Only emit a same-origin URL for an imported asset. Legacy or malformed
    // packs fall back to the schematic thumbnail instead of leaking a blocked
    // cross-origin Frank URL into the customer gallery.
    gallerySampleUrl: gallerySampleProxyUrl(String(row.pack_id ?? pack.packId), row.pack_json),
  };
}

function parsePackJson(value: unknown): TemplatePack | null {
  if (!value || typeof value !== "object") return null;
  const parsed = templatePackAnySchema.safeParse(value);
  return parsed.success ? (parsed.data as TemplatePack) : null;
}
