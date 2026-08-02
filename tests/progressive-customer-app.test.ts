import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("authenticated home is driven by the activation resolver and shared credit wallet", () => {
  const page = read("src/app/(customer)/self-serve/page.tsx");
  const dashboard = read("src/components/self-serve/home-dashboard.tsx");
  const card = read("src/components/self-serve/activation-card.tsx");

  assert.match(page, /resolveCustomerActivation/);
  assert.match(page, /workspace_credit_wallets/);
  assert.match(page, /billing_access_state/);
  assert.match(page, /onboarding_booked_at/);
  assert.doesNotMatch(page, /INCLUDED_AD_PACKS|usedAdPacks|remainingAdPacks/);
  assert.doesNotMatch(dashboard, /HomeSetupCard/);
  assert.match(dashboard, /<ActivationCard data=\{data\}/);
  assert.match(card, /Enough for up to \$\{packEstimate\} complete Feed \+ Story/);
  assert.match(card, /activation\.resumePath/);
});

test("onboarding starts with an explicit AU or US website scan and canonical Brand Pack review", () => {
  const wizard = read("src/components/onboarding/onboarding-wizard.tsx");
  const route = read("src/app/api/workspace/onboarding-market/route.ts");

  assert.match(wizard, /Start with your website/);
  assert.match(wizard, /Country and billing currency/);
  assert.match(wizard, /\/api\/adstudio\/brand-kits\/extract/);
  assert.match(wizard, /\/approve/);
  assert.match(wizard, /Add the essentials instead/);
  assert.match(wizard, /Review all details/);
  assert.doesNotMatch(wizard, /Confirm your profile|Connect your ad accounts/);

  assert.match(route, /country !== "AU" && country !== "US"/);
  assert.match(route, /AU: "AUD"/);
  assert.match(route, /US: "USD"/);
  assert.match(route, /recordCustomerActivationMilestone/);
  assert.match(route, /milestone: "country_confirmed"/);
  assert.match(route, /billing_checkout_completed_at/);
  assert.match(route, /provider_connections/);
  assert.match(route, /assisted workspace migration/);
});

test("settings expose profile, usage, market binding, booking, and five named seats", () => {
  const account = read("src/app/(customer)/settings/account-section.tsx");
  const billing = read("src/app/(customer)/settings/billing-section.tsx");
  const workspace = read("src/app/(customer)/settings/workspace-section.tsx");
  const team = read("src/app/(customer)/settings/team-section.tsx");

  assert.match(account, /Preferred name/);
  assert.match(account, /Phone \(optional\)/);
  assert.match(account, /Timezone/);
  assert.match(account, /Sign out other sessions/);
  assert.match(billing, /Usage this period/);
  assert.match(billing, /credits expire at period end/i);
  assert.match(billing, /Onboarding call/);
  assert.match(workspace, /Primary website/);
  assert.match(workspace, /workspace\.marketBound/);
  assert.match(workspace, /assisted workspace migration/);
  assert.match(team, /owner plus four invited, email-verified members/);
  assert.match(team, /reservedSeatCount} of 5 reserved/);
  assert.match(team, /Verification pending/);
  assert.match(team, /cancelInvitation/);
  assert.match(team, /billingAccessState !== "paid"/);
});

test("team invitation endpoint reserves verified paid seats without creating membership", () => {
  const route = read("src/app/api/settings/team/invite/route.ts");

  assert.match(route, /access\.role !== "owner"/);
  assert.match(route, /reserve_verified_workspace_invitation/);
  assert.match(route, /case "seat_limit_reached"/);
  assert.match(route, /All five named seats are in use/);
  assert.doesNotMatch(route, /from\("workspace_members"\)/);
  assert.doesNotMatch(route, /const ALLOWED_ROLES = \["owner"/);
});

test("canonical Brand Pack extraction accepts exactly AU and US end to end", () => {
  const extraction = read("src/lib/adstudio/brand-extraction.ts");
  const types = read("src/lib/adstudio/types.ts");
  const route = read("src/app/api/adstudio/brand-kits/extract/route.ts");

  assert.match(extraction, /marketCountry: "AU" \| "US"/);
  assert.match(types, /marketCountry: "AU" \| "US"/);
  assert.match(route, /marketCountry\?: "AU" \| "US"/);
  assert.match(route, /body\.marketCountry !== "AU" && body\.marketCountry !== "US"/);
  assert.match(route, /marketCountry must be AU or US/);
});

test("five-seat invitation reservation is serialized transactionally and service-role only", () => {
  const migration = read("supabase/migrations/20260727030000_verified_workspace_invitations.sql");
  const route = read("src/app/api/settings/team/invite/route.ts");

  assert.match(migration, /create or replace function public\.reserve_verified_workspace_invitation/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_member_count \+ v_pending_count >= 5/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.match(route, /\.rpc\(\s*"reserve_verified_workspace_invitation"/s);
});
