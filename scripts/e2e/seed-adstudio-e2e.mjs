// Seeds the dedicated Ad Studio e2e user + workspace (idempotent).
//
// Used by the AdStudio E2E (Vercel Preview) workflow before running
// e2e/adstudio-real-loop.spec.ts. Creates/updates:
//   - an auth user (ADSTUDIO_E2E_EMAIL / ADSTUDIO_E2E_PASSWORD)
//   - its profile row
//   - a dedicated self-serve workspace (deterministic id below)
//   - owner membership
// Brand-kit approval is exercised by the spec itself through the real UI.
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

console.log(`Seeded AdStudio e2e fixture: ${email} → workspace ${ADSTUDIO_E2E_WORKSPACE_ID}`);
