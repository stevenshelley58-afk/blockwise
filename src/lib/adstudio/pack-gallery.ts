import { templatePackV2Schema } from "../../../packages/ad-template-pack-contract/src/index.ts";
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

type ImportReceiptRow = {
  pack_id: unknown;
  receipt: unknown;
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

/** Authenticated same-origin URL for one immutable declared image asset. */
export function templateAssetProxyUrl(packId: string, assetKey: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(packId) || !/^[A-Za-z0-9._-]+$/.test(assetKey)) return null;
  return `/api/adstudio/template-packs/${encodeURIComponent(packId)}/assets/${encodeURIComponent(assetKey)}`;
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

  const rows = (data ?? []) as PackRow[];
  const packIds = rows
    .map(row => typeof row.pack_id === "string" ? row.pack_id : null)
    .filter((packId): packId is string => Boolean(packId));
  if (packIds.length === 0) return [];

  const { data: receiptData, error: receiptError } = await supabase
    .from("ad_import_receipts")
    .select("pack_id, receipt")
    .eq("status", "active")
    .in("pack_id", packIds);
  if (receiptError) throw new Error(receiptError.message);
  const approvedPackIds = new Set(
    ((receiptData ?? []) as ImportReceiptRow[])
      .filter(row => isApprovedLayeredImportReceipt(row.receipt))
      .map(row => String(row.pack_id)),
  );

  const summaries: ImportedPackSummary[] = [];
  for (const row of rows) {
    if (!approvedPackIds.has(String(row.pack_id))) continue;
    const pack = parseLayeredPackJson(row.pack_json);
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
  const { data: receipt, error: receiptError } = await supabase
    .from("ad_import_receipts")
    .select("receipt")
    .eq("pack_id", packId)
    .eq("status", "active")
    .maybeSingle();
  if (receiptError) throw new Error(receiptError.message);
  if (!receipt || !isApprovedLayeredImportReceipt((receipt as { receipt: unknown }).receipt)) return null;

  const { data, error } = await supabase
    .from("ad_template_packs")
    .select("pack_json")
    .eq("pack_id", packId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return parseLayeredPackJson((data as { pack_json: unknown }).pack_json);
}

/**
 * Customer-visible packs require the complete, sanitized release lineage.
 * Merely setting a database row to `active` cannot bypass the iterative visual
 * QA and explicit 100%-zoom approval gates.
 */
export function isApprovedLayeredImportReceipt(value: unknown): boolean {
  const receipt = record(value);
  const provenance = record(receipt?.provenance);
  if (
    receipt?.schema !== "blockwise.ad-template-import-receipt.v1" ||
    receipt?.status !== "active" ||
    !provenance
  ) return false;

  for (const field of [
    "runId",
    "releaseId",
    "traceRef",
    "qaReceiptRef",
    "approvalReceiptRef",
    "sanitizationReceiptRef",
  ] as const) {
    const candidate = provenance[field];
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) return false;
  }
  return true;
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

/**
 * Customer Ad Studio deliberately exposes only the source-free layered v2
 * release contract. Historical v1 rows remain available for audit/rollback,
 * but cannot silently reappear in the gallery or editor.
 */
export function parseLayeredPackJson(value: unknown): TemplatePack | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { schema?: unknown }).schema !== "blockwise.template-pack/v2") return null;
  const parsed = templatePackV2Schema.safeParse(value);
  return parsed.success ? (parsed.data as unknown as TemplatePack) : null;
}
