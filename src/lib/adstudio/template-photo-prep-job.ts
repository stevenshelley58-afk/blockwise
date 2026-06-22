import { createHash } from "node:crypto";

import { createSupabaseServiceClient } from "../supabase/service.ts";

import {
  loadAdStudioCampaignPack,
  persistAdStudioCampaignPack,
} from "./persistence.ts";
import {
  preparePhotoAssetsForTemplate,
  preparedPhotoUrlsByFormat,
  type PreparedPhotoAssetsByFormat,
  type TemplatePhotoPrepInput,
} from "./photo-prep-service.ts";
import { renderCreativeSvg } from "./renderer.ts";
import type { AdStudioCampaignPack, AdStudioCreative, AdStudioFormat } from "./types.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AdStudioTemplatePhotoPrepPayload = TemplatePhotoPrepInput & {
  campaignId?: string | null;
};

export type TemplatePhotoPrepTaskKeys = {
  idempotencyKey: string;
  concurrencyKey: string;
  contentKey: string;
};

export type TemplatePhotoPrepJobSummary = {
  campaignId: string | null;
  requestedFormats: AdStudioFormat[];
  preparedFormats: AdStudioFormat[];
  campaignUpdated: boolean;
};

export function buildTemplatePhotoPrepTaskKeys(input: AdStudioTemplatePhotoPrepPayload): TemplatePhotoPrepTaskKeys {
  const contentKey = hashShort(
    JSON.stringify({
      workspaceId: input.workspaceId,
      sourceImageRef: input.sourceImageRef,
      sourceImageHash: hashShort(input.sourceImageForModel),
      templateKey: input.template.templateKey ?? input.template.id,
      templateVersion: input.template.creativeSkeleton?.version ?? 1,
      formats: [...new Set(input.formats)].sort(),
      sourceImagesBySlot: Object.fromEntries(
        Object.entries(input.sourceImagesBySlot ?? {}).map(([slotId, source]) => [
          slotId,
          {
            sourceImageRef: source.sourceImageRef,
            sourceImageHash: hashShort(source.sourceImageForModel),
          },
        ]),
      ),
    }),
  );
  const campaignKey = input.campaignId?.trim() || "cache";

  return {
    contentKey,
    idempotencyKey: `adstudio-template-photo-prep:${contentKey}:${campaignKey}`,
    concurrencyKey: `adstudio-template-photo-prep:${input.workspaceId}:${contentKey}`,
  };
}

export async function runAdStudioTemplatePhotoPrepJob(
  payload: AdStudioTemplatePhotoPrepPayload,
  serviceSupabase: SupabaseServiceClient = createSupabaseServiceClient(),
): Promise<TemplatePhotoPrepJobSummary> {
  const assets = await preparePhotoAssetsForTemplate({
    ...payload,
    supabase: serviceSupabase,
  });
  const preparedFormats = Object.keys(preparedPhotoUrlsByFormat(assets)) as AdStudioFormat[];
  let campaignUpdated = false;

  if (payload.campaignId) {
    const pack = await loadCampaignPackWithRetry(serviceSupabase, payload.workspaceId, payload.campaignId);
    if (pack) {
      const updated = applyPreparedPhotoAssetsToCampaignPack(pack, assets);
      campaignUpdated = updated.changed;
      if (updated.changed) {
        if (!payload.userId) throw new Error("User id is required to persist prepared template photos.");
        const persisted = await persistAdStudioCampaignPack(serviceSupabase, updated.pack, payload.userId);
        if (persisted.error) throw new Error(persisted.error.message);
      }
    }
  }

  const summary = {
    campaignId: payload.campaignId ?? null,
    requestedFormats: [...new Set(payload.formats)],
    preparedFormats,
    campaignUpdated,
  };

  console.info(JSON.stringify({
    level: "info",
    msg: "adstudio_template_photo_prep_completed",
    workspaceId: payload.workspaceId,
    ...summary,
  }));

  return summary;
}

export function applyPreparedPhotoAssetsToCampaignPack(
  pack: AdStudioCampaignPack,
  assets: PreparedPhotoAssetsByFormat,
): { pack: AdStudioCampaignPack; changed: boolean } {
  let changed = false;
  const creatives = pack.creatives.map((creative) => {
    const slotAssets = assets[creative.format];
    if (!slotAssets || Object.keys(slotAssets).length === 0) return creative;

    const updated = applyPreparedPhotoAssetsToCreative(creative, slotAssets);
    if (updated !== creative) changed = true;
    return updated;
  });

  return changed ? { pack: { ...pack, creatives }, changed } : { pack, changed: false };
}

async function loadCampaignPackWithRetry(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  campaignId: string,
): Promise<AdStudioCampaignPack | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pack = await loadAdStudioCampaignPack(serviceSupabase, workspaceId, campaignId);
    if (pack) return pack;
    await sleep(1_500);
  }

  return null;
}

function applyPreparedPhotoAssetsToCreative(
  creative: AdStudioCreative,
  slotAssets: NonNullable<PreparedPhotoAssetsByFormat[AdStudioFormat]>,
): AdStudioCreative {
  let changed = false;
  const objects = creative.canvas.objects.map((object) => {
    if (object.type !== "image") return object;
    const asset = slotAssets[object.sourceLayerId ?? ""] ?? (object.role === "primary_image" ? primaryPreparedAsset(slotAssets) : undefined);
    if (!asset?.assetUrl || object.content === asset.assetUrl) return object;
    changed = true;
    return {
      ...object,
      content: asset.assetUrl,
      assetId: undefined,
    };
  });

  if (!changed) return creative;
  const next = {
    ...creative,
    canvas: {
      ...creative.canvas,
      objects,
    },
  };
  return {
    ...next,
    previewSvg: renderCreativeSvg(next),
  };
}

function primaryPreparedAsset(
  slotAssets: NonNullable<PreparedPhotoAssetsByFormat[AdStudioFormat]>,
) {
  return slotAssets.primary_photo ?? slotAssets.primary ?? Object.values(slotAssets)[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
