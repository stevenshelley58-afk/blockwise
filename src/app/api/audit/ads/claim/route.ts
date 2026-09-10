import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadListingPhoto, readAuditManifest, type AuditAdManifestAd } from "@/lib/audit/audit-ad-engine";
import { buildAuditTextValues, type AuditCopyContext } from "@/lib/audit/audit-ad-copy";
import {
  brandPackColoursToRoleMap,
  resolveBrandColourMap,
} from "@/lib/adstudio/brand-colours";
import { createCustomerAd, loadCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { parseCustomerImageRef } from "@/lib/adstudio/customer-image-ref";
import { storeCustomerImageBytes } from "@/lib/adstudio/customer-image-storage";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { resolveTemplateAssetValues } from "@/lib/adstudio/render-assets";
import { saveAd, SaveError } from "@/lib/adstudio/save-ad";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { adDocumentSchema } from "../../../../../../packages/ad-template-contract/src/schema.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClaimBody = {
  auditId?: string;
};

type LedgerResult = {
  ok: boolean;
  status?: string;
  reservationId?: string;
  code?: string;
};

function asLedgerResult(value: unknown): LedgerResult {
  if (!value || typeof value !== "object") return { ok: false };
  const row = value as Record<string, unknown>;
  return {
    ok: row.ok === true,
    status: typeof row.status === "string" ? row.status : undefined,
    reservationId: typeof row.reservation_id === "string" ? row.reservation_id : undefined,
    code: typeof row.code === "string" ? row.code : undefined,
  };
}

function websiteHostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

/**
 * POST /api/audit/ads/claim?workspaceId=...
 *
 * Saves the three anonymous audit previews into the caller's workspace as
 * real customer ads (revision 1 each). Authenticated: the caller must have
 * Ad Studio access to the workspace. Idempotent per audit id: replaying the
 * same audit returns the same ad ids without creating duplicates.
 */
export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { workspaceId } = access.access;
  const userSupabase: SupabaseClient = access.supabase;

  const body = await readJsonBody<ClaimBody>(request);
  const auditId = (body.auditId ?? "").trim();
  if (!AUDIT_ID.test(auditId)) {
    return NextResponse.json({ error: "Unknown audit. Generate your ads again." }, { status: 400 });
  }

  const limit = await checkRateLimit(null, `ws:${workspaceId}`, {
    windowSeconds: 600,
    maxRequests: 5,
    bucket: "audit-ad-claim",
    failClosed: false,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many claims from this workspace. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const service = createSupabaseServiceClient();
  const manifest = await readAuditManifest(service, auditId);
  if (!manifest || manifest.ads.length === 0) {
    return NextResponse.json({ error: "This audit has expired. Generate your ads again." }, { status: 404 });
  }
  const manifestData = manifest;

  const context: AuditCopyContext = {
    businessName: manifest.businessName,
    suburb: manifest.suburb,
    postcode: manifest.postcode,
    websiteHost: websiteHostOf(manifest.websiteUrl),
    phone: manifest.phone,
  };

  const adIds: string[] = [];

  for (let index = 0; index < manifest.ads.length; index += 1) {
    const entry = manifest.ads[index]!;
    try {
      const adId = await claimOneAd({
        requestSupabase: userSupabase,
        workspaceId,
        auditId,
        index,
        entry,
      });
      if (adId) adIds.push(adId);
    } catch (error) {
      console.error("audit ad claim failed", { auditId, index, error });
    }
  }

  async function claimOneAd(input: {
    requestSupabase: SupabaseClient;
    workspaceId: string;
    auditId: string;
    index: number;
    entry: AuditAdManifestAd;
  }): Promise<string | null> {
    const { requestSupabase, workspaceId, auditId, index, entry } = input;
    const template = await getTemplate(service, entry.templateId).catch(() => null);
    if (!template) return null;

    const created = await createCustomerAd(
      requestSupabase,
      workspaceId,
      template,
      `audit:${auditId}:${index}`,
    );
    const adId = created.adId;

    const existing = await loadCustomerAd(requestSupabase, workspaceId, adId).catch(() => null);
    if (existing && typeof existing.revisionNumber === "number") return adId;

    const hero =
      template.imageInputs.find((slot) => /hero|main|feature|primary/i.test(slot.key)) ??
      template.imageInputs[0] ??
      null;

    const sharedImageValues: Record<string, string> = {};
    const customerBytes: Record<string, Buffer> = {};
    if (entry.listingPhoto && hero) {
      const photo = await claimListingPhoto({
        workspaceId,
        adId,
        storagePath: entry.listingPhoto.storagePath,
        url: entry.listingPhoto.url,
      });
      if (photo) {
        sharedImageValues[hero.key] = photo.ref;
        customerBytes[hero.key] = photo.bytes;
      }
    }

    let templateAssets: Record<string, Buffer>;
    try {
      templateAssets = await resolveTemplateAssetValues(adId, workspaceId, service);
    } catch {
      return null;
    }

    const dateAngle = entry.angleKey === "open home" || entry.angleKey === "single listing";
    const document = {
      schema: "blockwise.ad-document" as const,
      templateId: template.templateId,
      sharedImageValues,
      sharedTextValues: buildAuditTextValues(template, entry.copy, context, { dateAngle }),
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "brand_pack" as const,
      resolvedColourMap: resolveBrandColourMap(
        template.semanticColours,
        brandPackColoursToRoleMap(manifestData.colours),
      ),
      metaPrimaryText: entry.copy.meta.primaryText,
      metaHeadline: entry.copy.meta.headline,
      metaDescription: entry.copy.meta.description,
      metaCta: entry.copy.meta.cta,
      ...(manifestData.businessName.trim() ? { brandBusinessName: manifestData.businessName } : {}),
      revision: 1,
    };

    const parsed = adDocumentSchema.safeParse(document);
    if (!parsed.success) {
      console.error("audit claim document failed validation", { auditId, index });
      return null;
    }

    try {
      await saveAd({
        supabase: requestSupabase,
        templateSupabase: service,
        workspaceId,
        adId,
        document: parsed.data,
        expectedRevision: 0,
        colourMap: parsed.data.resolvedColourMap,
        imageValues: { ...templateAssets, ...customerBytes },
      });
      return adId;
    } catch (error) {
      if (error instanceof SaveError && error.code === "stale_revision") {
        const raced = await loadCustomerAd(requestSupabase, workspaceId, adId).catch(() => null);
        if (raced && typeof raced.revisionNumber === "number") return adId;
      }
      throw error;
    }
  }

  async function claimListingPhoto(input: {
    workspaceId: string;
    adId: string;
    storagePath?: string | null;
    url?: string | null;
  }): Promise<{ ref: string; bytes: Buffer } | null> {
    try {
      const bytes = await loadListingPhoto(service, {
        storagePath: input.storagePath ?? null,
        url: input.url ?? null,
      });
      if (!bytes) return null;
      const stored = await storeCustomerImageBytes({
        bytes,
        workspaceId: input.workspaceId,
        adId: input.adId,
        supabase: service,
      });
      const parsed = parseCustomerImageRef(stored.ref, input.workspaceId, input.adId);
      if (!parsed) return null;

      const prepared = await service.rpc("adstudio_prepare_customer_image_upload", {
        p_workspace_id: input.workspaceId,
        p_ad_id: input.adId,
        p_object_path: parsed.path,
        p_sha256: stored.sha256,
        p_mime_type: stored.mime,
        p_byte_size: stored.bytes.length,
      });
      const ready = asLedgerResult(prepared.data);
      if (prepared.error || !ready.ok) return null;
      if (ready.status === "finalized") return { ref: stored.ref, bytes: stored.bytes };
      if (!ready.reservationId) return null;

      const claimed = await service.rpc("adstudio_claim_customer_image_finalize", {
        p_reservation_id: ready.reservationId,
        p_workspace_id: input.workspaceId,
        p_ad_id: input.adId,
        p_object_path: parsed.path,
        p_sha256: stored.sha256,
        p_mime_type: stored.mime,
        p_byte_size: stored.bytes.length,
      });
      if (claimed.error || !asLedgerResult(claimed.data).ok) return null;

      const finalized = await service.rpc("adstudio_finalize_customer_image_upload", {
        p_reservation_id: ready.reservationId,
        p_workspace_id: input.workspaceId,
        p_ad_id: input.adId,
        p_object_path: parsed.path,
        p_sha256: stored.sha256,
        p_mime_type: stored.mime,
        p_byte_size: stored.bytes.length,
      });
      if (finalized.error || !asLedgerResult(finalized.data).ok) return null;
      return { ref: stored.ref, bytes: stored.bytes };
    } catch (error) {
      console.error("audit claim photo skipped", { auditId, error });
      return null;
    }
  }

  if (adIds.length === 0) {
    return NextResponse.json({ error: "We could not save these ads. Try again." }, { status: 502 });
  }
  return NextResponse.json({ adIds });
}
