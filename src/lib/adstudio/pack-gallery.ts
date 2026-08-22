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
    gallerySampleUrl: readGallerySampleUrl(row.pack_json),
  };
}

function parsePackJson(value: unknown): TemplatePack | null {
  if (!value || typeof value !== "object") return null;
  const parsed = templatePackAnySchema.safeParse(value);
  return parsed.success ? (parsed.data as TemplatePack) : null;
}
