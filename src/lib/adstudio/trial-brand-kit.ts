import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { deterministicUuid } from "./id.ts";
import { isExampleBrandKitSourceUrl, persistAdStudioBrandKit, rowToBrandKit } from "./persistence.ts";
import type { AdStudioBrandKit } from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ResolveGenerationBrandKitInput = {
  supabase: SupabaseServerClient;
  workspaceId: string;
  workspaceName?: string;
  region?: string;
  userId: string;
};

export async function resolveAdStudioGenerationBrandKit(input: ResolveGenerationBrandKitInput): Promise<{
  ok: true;
  brandKit: AdStudioBrandKit;
} | {
  ok: false;
  error: string;
  status: 400 | 409;
}> {
  const approvedBrandKit = await loadApprovedBrandKit(input.supabase, input.workspaceId);

  if (approvedBrandKit) {
    return { ok: true, brandKit: approvedBrandKit };
  }

  // A Brand Pack improves generation but never gates it. Prefer the latest
  // customer draft, then create a neutral warning-state fallback when the
  // workspace has not saved any brand details yet.
  const draftBrandKit = await loadDraftBrandKit(input.supabase, input.workspaceId);

  if (draftBrandKit) {
    return { ok: true, brandKit: draftBrandKit };
  }

  const fallbackBrandKit = buildAdStudioFallbackBrandKit({
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

export function buildAdStudioFallbackBrandKit(input: {
  workspaceId: string;
  workspaceName?: string;
  region?: string;
}): AdStudioBrandKit {
  const businessName = cleanWorkspaceName(input.workspaceName);
  const fallback: AdStudioBrandKit = {
    brandKitId: deterministicUuid(`${input.workspaceId}:starter-brand-kit`),
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
      primary: "#123E75",
      secondary: "#F1F5F9",
      accent: "#31C46F",
      background: "#FFFFFF",
      text: "#131B2E",
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
    reviewStatus: "pending_user_review",
    lockedFields: ["starter_brand"],
  };

  return fallback;
}

async function loadApprovedBrandKit(
  supabase: SupabaseServerClient,
  workspaceId: string,
): Promise<AdStudioBrandKit | null> {
  return loadBrandKitByStatus(supabase, workspaceId, "approved");
}

/** Latest unapproved non-demo kit — B2 lets generation (never publish) run on it. */
async function loadDraftBrandKit(
  supabase: SupabaseServerClient,
  workspaceId: string,
): Promise<AdStudioBrandKit | null> {
  return loadBrandKitByStatus(supabase, workspaceId, "draft");
}

async function loadBrandKitByStatus(
  supabase: SupabaseServerClient,
  workspaceId: string,
  mode: "approved" | "draft",
): Promise<AdStudioBrandKit | null> {
  let query = supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", workspaceId);

  query = mode === "approved" ? query.eq("review_status", "approved") : query.neq("review_status", "approved");

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(10);

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const nonDemoRows = rows.filter((row) => !isExampleBrandKitSourceUrl(String(row.source_url ?? "")));
  const realSourceRow = nonDemoRows.find((row) => String(row.source_url ?? "").trim());
  const selectedRow = realSourceRow ?? nonDemoRows[0];

  return selectedRow ? rowToBrandKit(selectedRow) : null;
}

function cleanWorkspaceName(value: string | undefined): string {
  const name = value?.trim().replace(/\s+/g, " ");
  return name || "Your Agency";
}
