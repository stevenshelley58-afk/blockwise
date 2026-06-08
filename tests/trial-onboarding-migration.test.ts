import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606040004_self_serve_trial.sql";

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

test("self-serve trial migration adds trial plan and workspace lifecycle fields", () => {
  const sql = readMigration();

  assert.match(sql, /insert into public\.workspace_plans/i);
  assert.match(sql, /\('trial', 'Free Trial', 0, 1, 0\)/i);
  assert.match(sql, /add column if not exists trial_started_at timestamptz/i);
  assert.match(sql, /add column if not exists trial_ends_at timestamptz/i);
  assert.match(sql, /add column if not exists onboarding_status text not null default 'complete'/i);

  for (const status of ["not_started", "fast_path", "full_setup", "complete"]) {
    assert.match(sql, new RegExp(`'${status}'`, "i"));
  }

  assert.match(sql, /check \(onboarding_status in/i);
});

test("trial signup trigger provisions only self-serve trial signups", () => {
  const sql = readMigration();

  assert.match(sql, /new\.raw_user_meta_data->>'signup_flow'[\s\S]*<> 'trial_self_serve'/i);
  assert.match(sql, /create trigger on_trial_self_serve_signup[\s\S]*on auth\.users/i);
  assert.match(sql, /insert into public\.profiles/i);
  assert.match(sql, /insert into public\.workspaces/i);
  assert.match(sql, /'self_serve'/i);
  assert.match(sql, /'not_started'/i);
  assert.match(sql, /insert into public\.workspace_members[\s\S]*'owner'/i);
  assert.match(sql, /insert into public\.rate_limits/i);
  assert.match(sql, /'ad_pack_generation'/i);
  assert.match(sql, /'trial'/i);
  assert.match(sql, /10,\s*0,\s*v_trial_ends_at/i);
  assert.match(sql, /regexp_replace\(btrim\(coalesce\(new\.raw_user_meta_data->>'agency_name', ''\)\), '\\s\+', ' ', 'g'\)/i);
  assert.match(sql, /left\([\s\S]*160/i);
  assert.doesNotMatch(sql, /raw_user_meta_data->>'onboarding_status'/i);
});

test("rate limits are server-owned for writes and keep workspace select policy intact", () => {
  const sql = readMigration();

  for (const action of ["insert", "update", "delete"]) {
    assert.match(sql, new RegExp(`drop policy if exists workspace_${action} on public\\.rate_limits`, "i"));
    assert.match(sql, new RegExp(`rate_limits_server_owned_no_client_${action}`, "i"));
  }

  assert.doesNotMatch(sql, /drop policy if exists workspace_select on public\.rate_limits/i);
});

test("trial credit RPCs are service-role guarded and race-safe", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function public\.reserve_trial_ad_pack_credit\(\s*target_workspace_id uuid,\s*actor_profile_id uuid\s*\)/i);
  assert.match(sql, /returns table \(\s*allowed boolean,\s*reason text,\s*used_count integer,\s*limit_count integer,\s*trial_ends_at timestamptz\s*\)/i);
  assert.match(sql, /v_plan_key is distinct from 'trial'[\s\S]*'not_trial'/i);
  assert.match(sql, /'trial_expired'/i);
  assert.match(sql, /'credit_limit_reached'/i);
  assert.match(sql, /'reserved'/i);
  assert.match(sql, /update public\.rate_limits rl[\s\S]*set used_count = rl\.used_count \+ 1[\s\S]*rl\.used_count < rl\.limit_count/i);
  assert.match(sql, /insert into public\.audit_logs/i);
  assert.match(sql, /trial\.ad_pack_credit_reserved/i);
  assert.match(sql, /revoke all on function public\.reserve_trial_ad_pack_credit\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reserve_trial_ad_pack_credit\(uuid, uuid\) to service_role/i);

  assert.match(sql, /create or replace function public\.refund_trial_ad_pack_credit\(target_workspace_id uuid\)/i);
  assert.match(sql, /set used_count = greatest\(used_count - 1, 0\)/i);
  assert.match(sql, /grant execute on function public\.refund_trial_ad_pack_credit\(uuid\) to service_role/i);
});

test("trial status RPC is authenticated and membership guarded", () => {
  const sql = readMigration();

  assert.match(sql, /create or replace function public\.get_trial_status\(target_workspace_id uuid\)/i);
  assert.match(sql, /plan_key text/i);
  assert.match(sql, /ad_packs_remaining integer/i);
  assert.match(sql, /trial_days_remaining integer/i);
  assert.match(sql, /trial_expired boolean/i);
  assert.match(sql, /public\.is_operator\(\) or public\.is_workspace_member\(w\.id\)/i);
  assert.match(sql, /revoke all on function public\.get_trial_status\(uuid\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.get_trial_status\(uuid\) to authenticated/i);
});
