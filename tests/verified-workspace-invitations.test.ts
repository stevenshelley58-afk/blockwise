import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { acceptVerifiedWorkspaceInvitations } from "../src/lib/auth/verified-workspace-invitations.ts";

const migrationPath = "supabase/migrations/20260727030000_verified_workspace_invitations.sql";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("seat reservation counts active invitations and members under the workspace lock", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create table public\.workspace_invitations/i);
  assert.match(sql, /select w\.billing_access_state, w\.mode[\s\S]*where w\.id = p_workspace_id[\s\S]*for update/i);
  assert.match(sql, /from public\.workspace_members wm[\s\S]*into v_member_count/i);
  assert.match(sql, /from public\.workspace_invitations wi[\s\S]*wi\.status = 'pending'[\s\S]*wi\.expires_at > now\(\)/i);
  assert.match(sql, /v_member_count \+ v_pending_count >= 5/i);
  assert.match(sql, /workspace_invitations_one_pending_email_idx[\s\S]*where status = 'pending'/i);
  assert.doesNotMatch(sql, /grant_workspace_credits|workspace_credit_wallets|credit_ledger/i);
});

test("membership is impossible before authoritative auth email verification", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create trigger enforce_verified_workspace_member_seat[\s\S]*before insert on public\.workspace_members/i);
  assert.match(sql, /select coalesce\(u\.email_confirmed_at, u\.confirmed_at\)[\s\S]*from auth\.users u/i);
  assert.match(sql, /if v_verified_at is null[\s\S]*raise exception 'Email verification is required before workspace membership'/i);
  assert.match(sql, /drop policy if exists workspace_members_admin_write/i);
  assert.match(sql, /create policy workspace_members_admin_update/i);
  assert.match(sql, /create policy workspace_members_admin_delete/i);
  assert.doesNotMatch(sql, /create policy workspace_members[\s\S]{0,80}for insert/i);
});

test("acceptance matches the normalized authoritative auth email and is idempotent", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create or replace function public\.accept_verified_workspace_invitations\(\s*p_verified_user_id uuid/i);
  assert.match(sql, /v_email := lower\(btrim\(coalesce\(v_user\.email, ''\)\)\)/i);
  assert.match(sql, /wi\.email_normalized = v_email[\s\S]*wi\.status = 'pending'/i);
  assert.doesNotMatch(sql, /accept_verified_workspace_invitations\([^)]*p_email/i);
  assert.match(sql, /if exists \([\s\S]*from public\.workspace_members wm[\s\S]*outcome := 'already_member'/i);
  assert.match(sql, /update public\.workspace_invitations[\s\S]*status = 'accepted'[\s\S]*accepted_by = p_verified_user_id/i);
});

test("expired and cancelled invitations release their reserved seats and are audited", () => {
  const sql = read(migrationPath);

  assert.match(sql, /status = 'expired'[\s\S]*wi\.expires_at <= now\(\)/i);
  assert.match(sql, /create or replace function public\.cancel_workspace_invitation/i);
  assert.match(sql, /status = case when expires_at <= now\(\) then 'expired' else 'cancelled' end/i);
  assert.match(sql, /team\.invitation_expired/i);
  assert.match(sql, /team\.invitation_cancelled/i);
  assert.match(sql, /team\.invitation_reserved/i);
  assert.match(sql, /team\.invitation_accepted/i);
});

test("invitation table is workspace-readable while all lifecycle mutations remain service-role only", () => {
  const sql = read(migrationPath);

  assert.match(sql, /alter table public\.workspace_invitations enable row level security/i);
  assert.match(sql, /create policy workspace_invitations_select_managers/i);
  assert.match(sql, /has_workspace_role\(workspace_id, array\['owner', 'admin', 'operator'\]\)/i);
  assert.match(sql, /revoke all on table public\.workspace_invitations from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.workspace_invitations to authenticated/i);

  for (const fn of [
    "reserve_verified_workspace_invitation\\(uuid, text, text, uuid\\)",
    "cancel_workspace_invitation\\(uuid, uuid, uuid, text\\)",
    "accept_verified_workspace_invitations\\(uuid\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*to service_role`, "i"));
  }
});

test("server acceptance hook refuses unverified sessions without calling the RPC", async () => {
  let called = false;
  const serviceSupabase = {
    rpc: async () => {
      called = true;
      return { data: [], error: null };
    },
  };

  await assert.rejects(
    acceptVerifiedWorkspaceInvitations({
      user: { id: "user-1", email: "member@example.com" },
      serviceSupabase: serviceSupabase as never,
    }),
    /verified email is required/i,
  );
  assert.equal(called, false);
});

test("server acceptance hook sends only verified user ID and normalizes RPC results", async () => {
  let args: unknown;
  const serviceSupabase = {
    rpc: async (name: string, input: unknown) => {
      args = { name, input };
      return {
        data: [{
          invitation_id: "invite-1",
          workspace_id: "workspace-1",
          outcome: "accepted",
        }],
        error: null,
      };
    },
  };

  const result = await acceptVerifiedWorkspaceInvitations({
    user: {
      id: "user-1",
      email: "Member@Example.com",
      email_confirmed_at: "2026-07-27T00:00:00.000Z",
    },
    serviceSupabase: serviceSupabase as never,
  });

  assert.deepEqual(args, {
    name: "accept_verified_workspace_invitations",
    input: { p_verified_user_id: "user-1" },
  });
  assert.deepEqual(result, [{
    invitationId: "invite-1",
    workspaceId: "workspace-1",
    outcome: "accepted",
  }]);
});

test("team route reserves before sending and never creates membership or profiles", () => {
  const route = read("src/app/api/settings/team/invite/route.ts");

  assert.match(route, /reserve_verified_workspace_invitation/);
  assert.match(route, /auth\.admin\.inviteUserByEmail/);
  assert.match(route, /auth\.signInWithOtp/);
  assert.match(route, /shouldCreateUser: false/);
  assert.match(route, /cancel_workspace_invitation/);
  assert.doesNotMatch(route, /allocate_paid_workspace_member_seat/);
  assert.doesNotMatch(route, /from\("workspace_members"\)/);
  assert.doesNotMatch(route, /from\("profiles"\)/);
});
