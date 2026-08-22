import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit } from "@/lib/adstudio/types";
import { deriveFormGenerationInput, generateInstantForm, validateInstantForm } from "@/lib/adstudio/instant-form-generator";
import { instantFormSchema, type InstantForm } from "@/lib/adstudio/instant-form-types";
import { sha256Hex } from "../../../../../../../packages/ad-template-pack-contract/src/hash.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

// ---------------------------------------------------------------------------
// Instant Form drafts — customer-facing, workspace-scoped.
//
// GET  — latest pinned draft (form + revision + validation issues), or null.
// POST — generate a fresh draft from authoritative server state (ad meta
//        copy + Brand Pack + pack classification). NOT persisted; the
//        customer previews/edits it, then Save pins it.
// PUT  — pin (save) a draft as the next revision. Refuses drafts with
//        error-severity validation issues (warnings are allowed).
// ---------------------------------------------------------------------------

/** GET /api/adstudio/ads/[id]/instant-form?workspaceId=... */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const ad = await loadAd(access.supabase, id, access.access.workspaceId);
  if (!ad) return NextResponse.json({ error: "Ad not found" }, { status: 404 });

  const { data: draftRow } = await access.supabase
    .from("ad_instant_form_drafts")
    .select("form_json, revision")
    .eq("ad_id", id)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draftRow) {
    return NextResponse.json({ form: null, revision: null, issues: [] });
  }

  const form = draftRow.form_json as InstantForm;
  return NextResponse.json({ form, revision: draftRow.revision, issues: validateInstantForm(form) });
}

/** POST /api/adstudio/ads/[id]/instant-form?workspaceId=... — draft only, no persistence. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const ad = await loadAd(access.supabase, id, access.access.workspaceId);
  if (!ad) return NextResponse.json({ error: "Ad not found" }, { status: 404 });

  const contextInput = await buildFormGenerationContext(
    access.supabase,
    access.access.workspaceId,
    ad,
  );

  const generated = generateInstantForm(deriveFormGenerationInput(contextInput));
  const form = applyTemplateFormDefaults(generated.form, contextInput.templateFormDefaults, contextInput.privacyPolicyUrl);
  const issues = validateInstantForm(form);

  return NextResponse.json({ form, issues });
}

/** PUT /api/adstudio/ads/[id]/instant-form?workspaceId=... — pin (save) the draft. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const ad = await loadAd(access.supabase, id, access.access.workspaceId);
  if (!ad) return NextResponse.json({ error: "Ad not found" }, { status: 404 });

  const body = await readJsonBody<{ form?: unknown }>(request);

  const parsed = instantFormSchema.safeParse(body.form);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_form", issues: parsed.error.issues }, { status: 400 });
  }

  const issues = validateInstantForm(parsed.data);
  if (issues.some(issue => issue.severity === "error")) {
    return NextResponse.json({ error: "form_has_errors", issues }, { status: 422 });
  }

  try {
    const revision = await pinForm(access.supabase, id, access.access.workspaceId, parsed.data);
    return NextResponse.json({ form: parsed.data, issues, revision, pinned: true });
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Server-side state loading
// ---------------------------------------------------------------------------

type AdRow = {
  id: string;
  template_pack_id: string;
  meta_primary_text: string;
  meta_headline: string;
  meta_description: string;
  meta_cta: string;
};

async function loadAd(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  adId: string,
  workspaceId: string,
): Promise<AdRow | null> {
  const { data } = await supabase
    .from("ad_customer_ads")
    .select("id, template_pack_id, meta_primary_text, meta_headline, meta_description, meta_cta")
    .eq("id", adId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  return (data as AdRow | null) ?? null;
}

/**
 * Latest non-demo Brand Pack for the workspace (same selection as the pack
 * editor page): business name, contact details, and privacy policy URL.
 */
async function loadBrandKit(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<AdStudioBrandKit | null> {
  const { data } = await supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(10);

  const nonDemoRows = (data ?? []).filter(row => !isExampleBrandKitSourceUrl(String(row.source_url ?? "")));
  const row = nonDemoRows.find(candidate => String(candidate.source_url ?? "").trim()) ?? nonDemoRows[0];
  if (!row) return null;

  return rowToBrandKit(row);
}

/** Pack classification label — fallback campaign goal when the ad has no copy. */
async function loadPackContext(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  templatePackId: string,
): Promise<{ goal?: string; templateFormDefaults?: unknown }> {
  const { data } = await supabase
    .from("ad_template_packs")
    .select("pack_json")
    .eq("pack_id", templatePackId)
    .maybeSingle();

  const pack = data?.pack_json as {
    classification?: { label?: string };
    metadata?: { publishRequirements?: { instantForm?: { defaults?: unknown } } };
  } | null;
  return {
    goal: pack?.classification?.label?.trim() || undefined,
    templateFormDefaults: pack?.metadata?.publishRequirements?.instantForm?.defaults,
  };
}

async function buildFormGenerationContext(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
  ad: AdRow,
) {
  const [brandKit, packContext, workspaceRow] = await Promise.all([
    loadBrandKit(supabase, workspaceId),
    loadPackContext(supabase, ad.template_pack_id),
    supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
  ]);

  const businessName = brandKit?.identity.businessName?.trim()
    || brandKit?.identity.tradingName?.trim()
    || String(workspaceRow?.data?.name ?? "").trim()
    || "Your business";

  return {
    ad: {
      metaPrimaryText: ad.meta_primary_text,
      metaHeadline: ad.meta_headline,
      metaDescription: ad.meta_description,
      metaCta: ad.meta_cta,
    },
    business: {
      name: businessName,
      phone: brandKit?.contact.phone ?? undefined,
      email: brandKit?.contact.email ?? undefined,
    },
    privacyPolicyUrl: usablePrivacyUrl(brandKit),
    fallbackGoal: packContext.goal,
    templateFormDefaults: packContext.templateFormDefaults,
  };
}

function applyTemplateFormDefaults(base: InstantForm, value: unknown, privacyPolicyUrl: string): InstantForm {
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const defaults = value as Partial<InstantForm>;
  const intro = defaults.intro && typeof defaults.intro === "object" ? defaults.intro : undefined;
  const privacy = defaults.privacy && typeof defaults.privacy === "object" ? defaults.privacy : undefined;
  const thankYou = defaults.thankYou && typeof defaults.thankYou === "object" ? defaults.thankYou : undefined;
  return {
    ...base,
    ...(typeof defaults.name === "string" ? { name: defaults.name } : {}),
    ...(defaults.formType === "higher_intent" || defaults.formType === "more_volume" ? { formType: defaults.formType } : {}),
    intro: { ...base.intro, ...intro },
    ...(Array.isArray(defaults.contactFields) ? { contactFields: defaults.contactFields } : {}),
    ...(Array.isArray(defaults.customQuestions) ? { customQuestions: defaults.customQuestions } : {}),
    privacy: {
      ...base.privacy,
      ...privacy,
      url: typeof privacy?.url === "string" && privacy.url.trim() ? privacy.url : privacyPolicyUrl,
    },
    thankYou: { ...base.thankYou, ...thankYou },
  } as InstantForm;
}

/**
 * Resolve a real privacy policy URL from the Brand Pack. Only real advertiser
 * URLs are used — a placeholder/missing URL yields "" so validation reports
 * `missing_privacy_url` and the customer can type the URL in the editor.
 */
function usablePrivacyUrl(brandKit: AdStudioBrandKit | null): string {
  if (!brandKit) return "";

  const direct = brandKit.compliance.privacyPolicyUrl?.trim();
  if (direct && /^https?:\/\/\S+$/i.test(direct)) return direct;

  const source = brandKit.source.url?.trim();
  if (source && /^https?:\/\/\S+$/i.test(source) && !/blockwise\.sale|example\.com|yourdomain/i.test(source)) {
    return `${source.replace(/\/+$/, "")}/privacy`;
  }

  return "";
}

// ---------------------------------------------------------------------------
// Pinning
// ---------------------------------------------------------------------------

/**
 * Insert the draft as the next revision (ad_id, revision unique). Retries on
 * unique-violation races — two editors pinning concurrently just bumps again.
 */
async function pinForm(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  adId: string,
  workspaceId: string,
  form: InstantForm,
): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: latest } = await supabase
      .from("ad_instant_form_drafts")
      .select("revision")
      .eq("ad_id", adId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();

    const revision = ((latest?.revision as number | undefined) ?? 0) + 1;

    const { error } = await supabase.from("ad_instant_form_drafts").insert({
      ad_id: adId,
      workspace_id: workspaceId,
      form_json: form as unknown as Record<string, unknown>,
      form_hash: sha256Hex(form),
      generated_by: "customer_edit",
      revision,
    });

    if (!error) return revision;
    if (!/duplicate|unique/i.test(String(error.message))) throw error;
  }

  throw new Error("Could not pin form draft — too many concurrent saves");
}
