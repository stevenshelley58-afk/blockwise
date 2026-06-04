import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { deterministicUuid } from "./id.ts";
import { approveAdStudioBrandKitForUse } from "./live-workflow.ts";
import { persistAdStudioBrandKit, rowToBrandKit } from "./persistence.ts";
import type { AdStudioBrandKit } from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ResolveGenerationBrandKitInput = {
  supabase: SupabaseServerClient;
  workspaceId: string;
  workspaceName?: string;
  region?: string;
  userId: string;
  submittedBrandKit?: AdStudioBrandKit;
  isTrialWorkspace: boolean;
};

export async function resolveAdStudioGenerationBrandKit(input: ResolveGenerationBrandKitInput): Promise<{
  ok: true;
  brandKit: AdStudioBrandKit;
} | {
  ok: false;
  error: string;
  status: 400 | 409;
}> {
  if (!input.isTrialWorkspace) {
    if (!input.submittedBrandKit) {
      return { ok: false, error: "Approved brandKit is required.", status: 400 };
    }

    if (input.submittedBrandKit.reviewStatus !== "approved") {
      return { ok: false, error: "Brand kit must be approved before campaign generation.", status: 409 };
    }

    return {
      ok: true,
      brandKit: {
        ...input.submittedBrandKit,
        workspaceId: input.workspaceId,
        reviewStatus: "approved",
      },
    };
  }

  const approvedBrandKit = await loadApprovedBrandKit(input.supabase, input.workspaceId);

  if (approvedBrandKit) {
    return { ok: true, brandKit: approvedBrandKit };
  }

  const fallbackBrandKit = buildTrialFallbackBrandKit({
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    region: input.region,
  });
  const persisted = await persistAdStudioBrandKit(input.supabase, fallbackBrandKit, input.userId);

  if (persisted.error) {
    throw new Error(persisted.error.message);
  }

  return { ok: true, brandKit: fallbackBrandKit };
}

export function buildTrialFallbackBrandKit(input: {
  workspaceId: string;
  workspaceName?: string;
  region?: string;
}): AdStudioBrandKit {
  const businessName = cleanWorkspaceName(input.workspaceName);
  const fallback: AdStudioBrandKit = {
    brandKitId: deterministicUuid(`${input.workspaceId}:trial-approved-brand-kit`),
    workspaceId: input.workspaceId,
    source: {
      type: "manual",
      url: "",
      lastExtractedAt: new Date().toISOString(),
      pagesScanned: [],
    },
    identity: {
      businessName,
      tradingName: businessName,
      marketCountry: "AU",
      marketRegion: input.region?.trim() || "AU",
      licenceText: null,
    },
    logos: {
      primaryLogoUrl: null,
      darkLogoUrl: null,
      lightLogoUrl: null,
      faviconUrl: null,
    },
    colours: {
      primary: "#087F7A",
      secondary: "#F1F5F2",
      accent: "#2364AA",
      background: "#FFFFFF",
      text: "#18201F",
      confidence: {
        primary: 0.52,
        secondary: 0.48,
      },
    },
    typography: {
      headingFont: "Inter",
      bodyFont: "Inter",
      fallbackHeading: "sans-serif",
      fallbackBody: "sans-serif",
    },
    visualStyle: {
      styleTags: ["professional", "local", "clean"],
      imageTreatment: "Bright local property imagery with clean brand typography.",
      layoutDensity: "low",
      cornerRadius: "medium",
    },
    tone: {
      voice: "professional local expert",
      avoid: ["hype", "cheap urgency", "unsupported guarantees"],
      preferredPhrases: ["local property advice", "seller checklist", "market update"],
      sampleCopy: [`Practical property advice from ${businessName}.`],
    },
    assets: {
      headshots: [],
      officeImages: [],
      listingImages: [],
      socialProofImages: [],
    },
    contact: {
      phone: null,
      email: null,
      address: null,
      socialLinks: [],
    },
    compliance: {
      disclaimers: ["Information is general only. Speak with a licensed local agent."],
      privacyPolicyUrl: null,
      termsUrl: null,
    },
    reviewStatus: "approved",
    lockedFields: [],
  };

  return approveAdStudioBrandKitForUse(fallback);
}

async function loadApprovedBrandKit(
  supabase: SupabaseServerClient,
  workspaceId: string,
): Promise<AdStudioBrandKit | null> {
  const { data, error } = await supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("review_status", "approved")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? rowToBrandKit(data) : null;
}

function cleanWorkspaceName(value: string | undefined): string {
  const name = value?.trim().replace(/\s+/g, " ");
  return name || "Your Agency";
}
