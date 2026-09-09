import { buildAdStudioLibrarySelectionPack, type AdStudioCreativeLibrarySelection } from "./creative-library.ts";
import type { AdStudioCampaignPack, MetaLeadAdPack } from "./types.ts";

export type AdStudioPublishLeadFormPatch = Pick<
  MetaLeadAdPack["leadForm"],
  "headline" | "questions" | "thankYouScreen"
>;

export type AuthorizedPublishPackResult =
  | { ok: true; pack: AdStudioCampaignPack }
  | { ok: false; status: 404 | 422; error: string };

export function parseAdStudioPublishLeadFormPatch(value: unknown):
  | { ok: true; value: AdStudioPublishLeadFormPatch | null }
  | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: null };
  if (!isExactRecord(value, ["headline", "questions", "thankYouScreen"])) {
    return { ok: false, error: "Lead form fields are invalid." };
  }
  if (
    typeof value.headline !== "string"
    || !Array.isArray(value.questions)
    || value.questions.some((question) => typeof question !== "string")
    || !isExactRecord(value.thankYouScreen, ["title", "body"])
    || typeof value.thankYouScreen.title !== "string"
    || typeof value.thankYouScreen.body !== "string"
  ) {
    return { ok: false, error: "Lead form fields are invalid." };
  }

  return {
    ok: true,
    value: {
      headline: value.headline.trim(),
      questions: value.questions.map((question) => question.trim()),
      thankYouScreen: {
        title: value.thankYouScreen.title.trim(),
        body: value.thankYouScreen.body.trim(),
      },
    },
  };
}

export async function resolveAuthorizedAdStudioPublishPack(input: {
  workspaceId: string;
  campaignId: string;
  leadFormPatch: AdStudioPublishLeadFormPatch | null;
  librarySelections: AdStudioCreativeLibrarySelection[];
  loadCampaign: (workspaceId: string, campaignId: string) => Promise<AdStudioCampaignPack | null>;
}): Promise<AuthorizedPublishPackResult> {
  const basePack = await input.loadCampaign(input.workspaceId, input.campaignId);
  if (!basePack || !isCanonicalPersistedPack(basePack, input.workspaceId, input.campaignId)) {
    return { ok: false, status: 404, error: "Campaign not found." };
  }

  const patchedBasePack = input.leadFormPatch ? applyLeadFormPatch(basePack, input.leadFormPatch) : basePack;
  if (input.librarySelections.length === 0) return { ok: true, pack: patchedBasePack };

  const sourceCampaignIds = [...new Set(input.librarySelections.map((selection) => selection.campaignId))];
  const sourcePacks = await Promise.all(
    sourceCampaignIds.map((campaignId) => input.loadCampaign(input.workspaceId, campaignId)),
  );
  if (sourcePacks.some((pack, index) => (
    !pack || !isCanonicalPersistedPack(pack, input.workspaceId, sourceCampaignIds[index] ?? "")
  ))) {
    return {
      ok: false,
      status: 422,
      error: "One of the selected ads is no longer available. Refresh the page and choose it again.",
    };
  }

  try {
    const pack = buildAdStudioLibrarySelectionPack(
      patchedBasePack,
      sourcePacks.filter((sourcePack): sourcePack is AdStudioCampaignPack => sourcePack !== null),
      input.librarySelections,
    );
    if (!isCanonicalDerivedPack(pack, patchedBasePack)) {
      return { ok: false, status: 422, error: "The selected ads could not be prepared safely." };
    }
    return { ok: true, pack };
  } catch (error) {
    return {
      ok: false,
      status: 422,
      error: error instanceof Error ? error.message : "The selected ads could not be prepared.",
    };
  }
}

function applyLeadFormPatch(
  pack: AdStudioCampaignPack,
  patch: AdStudioPublishLeadFormPatch,
): AdStudioCampaignPack {
  return {
    ...pack,
    copyPacks: pack.copyPacks.map((copyPack) => ({
      ...copyPack,
      meta: {
        ...copyPack.meta,
        leadForm: {
          ...copyPack.meta.leadForm,
          headline: patch.headline,
          questions: [...patch.questions],
          thankYouScreen: { ...patch.thankYouScreen },
        },
      },
    })),
  };
}

function isCanonicalPersistedPack(pack: AdStudioCampaignPack, workspaceId: string, campaignId: string): boolean {
  return pack.campaign.workspaceId === workspaceId
    && pack.campaign.campaignId === campaignId
    && pack.brandKit.workspaceId === workspaceId
    && pack.campaign.brandKitId === pack.brandKit.brandKitId
    && pack.variants.every((variant) => variant.campaignId === campaignId)
    && pack.creatives.every((creative) => creative.campaignId === campaignId)
    && pack.copyPacks.every((copyPack) => copyPack.campaignId === campaignId)
    && pack.compliance.campaignId === campaignId;
}

function isCanonicalDerivedPack(pack: AdStudioCampaignPack, basePack: AdStudioCampaignPack): boolean {
  const campaignId = basePack.campaign.campaignId;
  return pack.campaign.campaignId === campaignId
    && pack.campaign.workspaceId === basePack.campaign.workspaceId
    && pack.campaign.brandKitId === basePack.campaign.brandKitId
    && pack.brandKit.brandKitId === basePack.brandKit.brandKitId
    && pack.brandKit.workspaceId === basePack.brandKit.workspaceId
    && pack.variants.every((variant) => variant.campaignId === campaignId)
    && pack.creatives.every((creative) => creative.campaignId === campaignId)
    && pack.copyPacks.every((copyPack) => copyPack.campaignId === campaignId)
    && pack.compliance.campaignId === campaignId;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}
