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
//   - a token-free Meta connection fixture usable only while provider writes are disabled
//
// Env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, SUPABASE_SECRET_KEY
//      (preferred) or SUPABASE_SERVICE_ROLE_KEY,
//      ADSTUDIO_E2E_EMAIL (default adstudio-e2e@blockwise.test),
//      ADSTUDIO_E2E_PASSWORD (required, >= 16 chars).

import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "../lib/supabase-server-credential.mjs";

export const ADSTUDIO_E2E_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000e2";
export const ADSTUDIO_E2E_META_CONNECTION_ID = "00000000-0000-4000-8000-0000000000e4";

function cleanEnv(value) {
  return value?.replace(/^﻿/, "").trim();
}

const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
const serverCredential = resolveSupabaseServerCredential(process.env);
const email = (cleanEnv(process.env.ADSTUDIO_E2E_EMAIL) ?? "adstudio-e2e@blockwise.test").toLowerCase();
const password = cleanEnv(process.env.ADSTUDIO_E2E_PASSWORD);

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

// Publishing a dry-run plan still validates the account/Page/delivery contract.
// This dedicated fixture contains no token or provider credential and is marked
// so a writes-enabled deployment refuses to use it.
requireNoError(
  await supabase.from("provider_connections").upsert(
    {
      id: ADSTUDIO_E2E_META_CONNECTION_ID,
      workspace_id: ADSTUDIO_E2E_WORKSPACE_ID,
      provider: "meta",
      status: "connected",
      scopes: [],
      external_account_id: "act_blockwise_e2e_dry_run",
      external_account_name: "Blockwise E2E dry run",
      metadata_json: {
        e2eDryRunOnly: true,
        metaAdAccountId: "act_blockwise_e2e_dry_run",
        pageId: "page_blockwise_e2e_dry_run",
        leadDestination: {
          type: "manual",
          label: "E2E dry-run review",
        },
        privacyPolicyUrl: "https://example.com/privacy",
        currency: "AUD",
        timezone: "Australia/Perth",
      },
      health_status: "healthy",
      created_by: authUser.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,provider,external_account_id" },
  ),
  "Upsert AdStudio e2e token-free Meta connection",
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

console.log(`Seeded AdStudio e2e fixture: ${email} → workspace ${ADSTUDIO_E2E_WORKSPACE_ID}`);
