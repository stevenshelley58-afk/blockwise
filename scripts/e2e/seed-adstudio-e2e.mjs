// Seeds the dedicated Ad Studio e2e user + workspace (idempotent).
//
// Used by the AdStudio E2E (Vercel Preview) workflow before running
// e2e/adstudio-real-loop.spec.ts. Creates/updates:
//   - an auth user (ADSTUDIO_E2E_EMAIL / ADSTUDIO_E2E_PASSWORD)
//   - its profile row
//   - a dedicated self-serve workspace (deterministic id below)
//   - owner membership
//   - a six-credit operator entitlement for the current UTC month
//   - a reviewed Brand Pack so the spec can exercise appearance persistence
//
// Env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, SUPABASE_SECRET_KEY
//      (preferred) or SUPABASE_SERVICE_ROLE_KEY,
//      ADSTUDIO_E2E_EMAIL (default adstudio-e2e@blockwise.test),
//      ADSTUDIO_E2E_PASSWORD (required, >= 16 chars),
//      ADSTUDIO_E2E_TEMPLATE_ID (optional quarantined template to attach to a
//      deterministic test ad; the script prints ADSTUDIO_E2E_AD_ID).

import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "../lib/supabase-server-credential.mjs";

export const ADSTUDIO_E2E_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000e2";

function cleanEnv(value) {
  return value?.replace(/^﻿/, "").trim();
}

const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
const serverCredential = resolveSupabaseServerCredential(process.env);
const email = (cleanEnv(process.env.ADSTUDIO_E2E_EMAIL) ?? "adstudio-e2e@blockwise.test").toLowerCase();
const password = cleanEnv(process.env.ADSTUDIO_E2E_PASSWORD);
const quarantinedTemplateId = cleanEnv(process.env.ADSTUDIO_E2E_TEMPLATE_ID);

if (!supabaseUrl || !serverCredential) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.");
}
if (!password || password.length < 16) {
  throw new Error("Set ADSTUDIO_E2E_PASSWORD to a unique password of at least 16 characters.");
}

const supabase = createSupabaseServerClient(createClient, supabaseUrl, process.env, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function requireNoError(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function findAuthUserByEmail(target) {
  let page = 1;
  for (;;) {
    const data = requireNoError(await supabase.auth.admin.listUsers({ page, perPage: 100 }), "List users");
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === target);
    if (user) return user;
    if (data.users.length < 100) return null;
    page += 1;
  }
}

const attributes = {
  password,
  email_confirm: true,
  user_metadata: { full_name: "AdStudio E2E" },
};

const existing = await findAuthUserByEmail(email);
const authUser = existing
  ? requireNoError(await supabase.auth.admin.updateUserById(existing.id, attributes), `Update ${email}`).user
  : requireNoError(await supabase.auth.admin.createUser({ email, ...attributes }), `Create ${email}`).user;

requireNoError(
  await supabase.from("profiles").upsert(
    { id: authUser.id, email, full_name: "AdStudio E2E", is_operator: false },
    { onConflict: "id" },
  ),
  "Upsert profile",
);

const plan = requireNoError(
  await supabase.from("workspace_plans").select("id").eq("key", "growth").single(),
  "Fetch growth plan",
);

requireNoError(
  await supabase.from("workspaces").upsert(
    {
      id: ADSTUDIO_E2E_WORKSPACE_ID,
      name: "AdStudio E2E Realty",
      mode: "self_serve",
      plan_id: plan.id,
      region: "AU",
      managed_service_enabled: true,
      approval_required_by_default: true,
      created_by: authUser.id,
    },
    { onConflict: "id" },
  ),
  "Upsert workspace",
);

requireNoError(
  await supabase.from("workspace_members").upsert(
    { workspace_id: ADSTUDIO_E2E_WORKSPACE_ID, profile_id: authUser.id, role: "owner" },
    { onConflict: "workspace_id,profile_id" },
  ),
  "Upsert workspace member",
);

// Give the dedicated fixture workspace a reviewed, non-demo Brand Pack so the
// real-loop test can exercise the appearance toggle and persist that choice.
// This is deliberately a plain database fixture: no external site is fetched
// and no logo/identity asset is introduced into the customer flow.
requireNoError(
  await supabase.from("adstudio_brand_kits").upsert(
    {
      id: "00000000-0000-4000-8000-0000000000e3",
      workspace_id: ADSTUDIO_E2E_WORKSPACE_ID,
      source_type: "manual",
      source_url: "https://blockwise.sale",
      business_name: "AdStudio E2E Realty",
      market_country: "AU",
      market_region: "WA",
      identity_json: { businessName: "AdStudio E2E Realty", tradingName: "AdStudio E2E Realty" },
      logos_json: {},
      colours_json: {
        primary: "#123E75",
        secondary: "#F1F5F9",
        accent: "#31C46F",
        background: "#FFFFFF",
        text: "#131B2E",
        confidence: { primary: 0.99, secondary: 0.99 },
      },
      typography_json: { headingFont: "Inter", bodyFont: "Inter" },
      tone_json: {},
      visual_style_json: {},
      compliance_json: {},
      contact_json: {},
      review_status: "approved",
      locked_fields_json: [],
      created_by: authUser.id,
    },
    { onConflict: "id" },
  ),
  "Upsert AdStudio e2e Brand Pack",
);

// The browser workflow exercises the real paid render path. Keep its wallet
// explicit, small, monthly, and idempotent so a freshly seeded fixture cannot
// fail before generation while still putting a hard ceiling on test spend.
const now = new Date();
const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const periodKey = `adstudio-e2e-${periodStart.toISOString().slice(0, 7)}`;
requireNoError(
  await supabase.rpc("grant_workspace_credits", {
    p_workspace_id: ADSTUDIO_E2E_WORKSPACE_ID,
    p_entitlement_type: "operator",
    p_period_key: periodKey,
    p_credits: 6,
    p_period_start: periodStart.toISOString(),
    p_period_end: periodEnd.toISOString(),
    p_mutation_key: `adstudio-e2e:credit-grant:${periodStart.toISOString().slice(0, 7)}:v1`,
    p_source_reference: "adstudio-e2e-fixture",
    p_metadata: { fixture: true, scope: "preview-real-loop" },
  }),
  "Grant AdStudio e2e render credits",
);

let quarantinedAdId = null;
if (quarantinedTemplateId) {
  const template = requireNoError(
    await supabase
      .from("ad_templates")
      .select("template_id, template_json, library_status")
      .eq("template_id", quarantinedTemplateId)
      .single(),
    `Fetch quarantined template ${quarantinedTemplateId}`,
  );
  if (template.library_status !== "quarantined") {
    throw new Error(`Refusing to seed ${quarantinedTemplateId}: expected library_status=quarantined, got ${template.library_status}.`);
  }
  const semanticColours = template.template_json?.semanticColours;
  if (!semanticColours || typeof semanticColours !== "object" || Array.isArray(semanticColours)) {
    throw new Error(`Refusing to seed ${quarantinedTemplateId}: template_json.semanticColours is missing.`);
  }

  const creationKey = `adstudio-e2e:quarantined-canary:${quarantinedTemplateId}`;
  const existingAd = requireNoError(
    await supabase
      .from("ad_customer_ads")
      .select("id, template_id")
      .eq("workspace_id", ADSTUDIO_E2E_WORKSPACE_ID)
      .eq("creation_key", creationKey)
      .maybeSingle(),
    "Find quarantined canary ad",
  );
  if (existingAd && existingAd.template_id !== quarantinedTemplateId) {
    throw new Error(`Creation key collision for ${creationKey}.`);
  }
  const ad = existingAd ?? requireNoError(
    await supabase
      .from("ad_customer_ads")
      .insert({
        workspace_id: ADSTUDIO_E2E_WORKSPACE_ID,
        template_id: quarantinedTemplateId,
        name: `Quarantined canary ${quarantinedTemplateId}`,
        colour_mode: "template",
        resolved_colour_map: semanticColours,
        creation_key: creationKey,
      })
      .select("id, template_id")
      .single(),
    "Create quarantined canary ad",
  );
  quarantinedAdId = ad.id;
}

console.log(`Seeded AdStudio e2e fixture: ${email} → workspace ${ADSTUDIO_E2E_WORKSPACE_ID}`);
if (quarantinedAdId) console.log(`ADSTUDIO_E2E_AD_ID=${quarantinedAdId}`);
