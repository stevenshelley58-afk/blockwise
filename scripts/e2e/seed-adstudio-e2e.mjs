// Seeds the dedicated Ad Studio e2e user + workspace (idempotent).
//
// Used by the AdStudio E2E (Vercel Preview) workflow before running
// e2e/adstudio-real-loop.spec.ts. Creates/updates:
//   - an auth user (ADSTUDIO_E2E_EMAIL / ADSTUDIO_E2E_PASSWORD)
//   - its profile row
//   - a dedicated self-serve workspace (deterministic id below)
//   - owner membership
//   - one deterministic approved brand kit for reliable provider acceptance
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
export const ADSTUDIO_E2E_BRAND_KIT_ID = "00000000-0000-4000-8000-0000000000e3";

function cleanEnv(value) {
  return value?.replace(/^﻿/, "").trim();
}

const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
const serverCredential = resolveSupabaseServerCredential(process.env);
const email = (cleanEnv(process.env.ADSTUDIO_E2E_EMAIL) ?? "adstudio-e2e@blockwise.test").toLowerCase();
const password = cleanEnv(process.env.ADSTUDIO_E2E_PASSWORD);
const isOperator = /^(1|true|yes)$/iu.test(cleanEnv(process.env.ADSTUDIO_E2E_OPERATOR) ?? "");

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
    { id: authUser.id, email, full_name: "AdStudio E2E", is_operator: isOperator },
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

requireNoError(
  await supabase.from("adstudio_brand_kits").upsert(
    {
      id: ADSTUDIO_E2E_BRAND_KIT_ID,
      workspace_id: ADSTUDIO_E2E_WORKSPACE_ID,
      source_type: "manual",
      source_url: null,
      business_name: "AdStudio E2E Realty",
      market_country: "AU",
      market_region: "WA",
      identity_json: {
        businessName: "AdStudio E2E Realty",
        tradingName: "AdStudio E2E Realty",
        marketCountry: "AU",
        marketRegion: "WA",
        licenceText: null,
      },
      logos_json: { primaryLogoUrl: null, darkLogoUrl: null, lightLogoUrl: null, faviconUrl: null },
      colours_json: {
        primary: "#123E75",
        secondary: "#F1F5F9",
        accent: "#31C46F",
        background: "#FFFFFF",
        text: "#131B2E",
        confidence: { primary: 1, secondary: 1 },
      },
      typography_json: {
        headingFont: "Inter",
        bodyFont: "Inter",
        fallbackHeading: "sans-serif",
        fallbackBody: "sans-serif",
      },
      tone_json: {
        voice: "professional local expert",
        avoid: ["hype", "unsupported guarantees"],
        preferredPhrases: ["local property advice"],
        sampleCopy: ["Practical property advice from AdStudio E2E Realty."],
      },
      visual_style_json: {
        styleTags: ["professional", "local", "clean"],
        imageTreatment: "Bright local property imagery with clean brand typography.",
        layoutDensity: "low",
        cornerRadius: "medium",
      },
      compliance_json: {
        disclaimers: ["Information is general only. Speak with a licensed local agent."],
        privacyPolicyUrl: null,
        termsUrl: null,
      },
      contact_json: { phone: null, email: null, address: null, socialLinks: [] },
      review_status: "approved",
      locked_fields_json: [],
      created_by: authUser.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  ),
  "Upsert approved E2E brand kit",
);

console.log(`Seeded AdStudio e2e fixture: ${email} → workspace ${ADSTUDIO_E2E_WORKSPACE_ID}`);
