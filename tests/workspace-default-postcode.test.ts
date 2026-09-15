import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isFreshLocationProjection,
  normalizeVerifiedEmail,
  seedMissingWorkspacePostcode,
  verifiedEmailHash,
  workspacePostcodeSchema,
} from "../src/lib/workspace/default-postcode.ts";

type Response = { data: unknown; error: { message: string } | null };

function service(responses: Response[]) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        const response = responses.shift();
        if (!response) throw new Error(`Unexpected query for ${table}`);
        const query = {
          select(...args: unknown[]) { calls.push({ table, method: "select", args }); return query; },
          update(...args: unknown[]) { calls.push({ table, method: "update", args }); return query; },
          eq(...args: unknown[]) { calls.push({ table, method: "eq", args }); return query; },
          in(...args: unknown[]) { calls.push({ table, method: "in", args }); return query; },
          is(...args: unknown[]) { calls.push({ table, method: "is", args }); return query; },
          maybeSingle() { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(response); },
        };
        return query;
      },
    },
  };
}

const freshProjectedAt = new Date().toISOString();

const verifiedOwner = {
  id: "11111111-1111-4111-8111-111111111111",
  email: " Agent@Example.com ",
  email_confirmed_at: "2026-09-14T00:00:00.000Z",
};

test("postcode validation preserves leading zero and rejects unknown Australian postcodes", () => {
  assert.equal(workspacePostcodeSchema.parse(" 0800 "), "0800");
  assert.equal(workspacePostcodeSchema.safeParse("0000").success, false);
  assert.equal(workspacePostcodeSchema.safeParse("5678").success, false);
  assert.equal(workspacePostcodeSchema.safeParse("601").success, false);
});

test("verified email hashing is normalized and never stores the raw email", () => {
  assert.equal(normalizeVerifiedEmail(" Agent@Example.com "), "agent@example.com");
  assert.equal(verifiedEmailHash(" Agent@Example.com "), verifiedEmailHash("agent@example.com"));
  assert.match(verifiedEmailHash("agent@example.com"), /^[a-f0-9]{64}$/u);
  assert.notEqual(verifiedEmailHash("agent@example.com"), "agent@example.com");
});

test("a generic confirmation without authoritative email confirmation cannot seed", async () => {
  const fake = service([]);
  const result = await seedMissingWorkspacePostcode({
    serviceSupabase: fake.client as never,
    user: { ...verifiedOwner, email_confirmed_at: null, confirmed_at: "2026-09-14T00:00:00.000Z" } as never,
    workspaceId: "workspace-1",
  });
  assert.equal(result, null);
  assert.equal(fake.calls.length, 0);
});

test("members and operators cannot seed a shared workspace location", async () => {
  const fake = service([{ data: null, error: null }]);
  const result = await seedMissingWorkspacePostcode({
    serviceSupabase: fake.client as never,
    user: verifiedOwner as never,
    workspaceId: "workspace-1",
  });
  assert.equal(result, null);
  assert.deepEqual(fake.calls.filter((call) => call.method === "in")[0]?.args, ["role", ["owner", "admin"]]);
  assert.equal(fake.calls.some((call) => call.method === "update"), false);
});

test("an explicit workspace postcode wins without a projection lookup", async () => {
  const fake = service([
    { data: { role: "owner" }, error: null },
    { data: { default_postcode: "6019" }, error: null },
  ]);
  const result = await seedMissingWorkspacePostcode({ serviceSupabase: fake.client as never, user: verifiedOwner as never, workspaceId: "workspace-1" });
  assert.equal(result, "6019");
  assert.equal(fake.calls.some((call) => call.table === "research_email_location_projections"), false);
});

test("a verified owner can seed only a missing postcode from the hashed projection", async () => {
  const fake = service([
    { data: { role: "owner" }, error: null },
    { data: { default_postcode: null }, error: null },
    { data: { postcode: "6019", projected_at: freshProjectedAt }, error: null },
    { data: { default_postcode: "6019" }, error: null },
  ]);
  const result = await seedMissingWorkspacePostcode({ serviceSupabase: fake.client as never, user: verifiedOwner as never, workspaceId: "workspace-1" });
  assert.equal(result, "6019");
  assert.ok(fake.calls.some((call) => call.table === "research_email_location_projections" && call.method === "eq" && call.args[0] === "email_sha256" && call.args[1] === verifiedEmailHash(verifiedOwner.email)));
  assert.ok(fake.calls.some((call) => call.table === "workspaces" && call.method === "is" && call.args[0] === "default_postcode" && call.args[1] === null));
});


test("only a recently refreshed projection may seed a workspace", async () => {
  const now = Date.parse("2026-09-14T12:00:00.000Z");
  assert.equal(isFreshLocationProjection("2026-09-13T12:00:00.000Z", now), true);
  assert.equal(isFreshLocationProjection("2026-09-12T11:59:59.000Z", now), false);
  assert.equal(isFreshLocationProjection("not-a-date", now), false);

  const fake = service([
    { data: { role: "owner" }, error: null },
    { data: { default_postcode: null }, error: null },
    { data: { postcode: "6019", projected_at: "2020-01-01T00:00:00.000Z" }, error: null },
  ]);
  const result = await seedMissingWorkspacePostcode({ serviceSupabase: fake.client as never, user: verifiedOwner as never, workspaceId: "workspace-1" });
  assert.equal(result, null);
  assert.equal(fake.calls.some((call) => call.method === "update"), false);
});

test("workspace postcode persistence keeps the existing workspace RLS and server authorization boundary", () => {
  const migration = readFileSync("supabase/migrations/20260914010000_workspace_default_postcode.sql", "utf8");
  const route = readFileSync("src/app/api/workspace/default-postcode/route.ts", "utf8");
  assert.match(migration, /default_postcode text/i);
  assert.match(migration, /default_postcode is null or default_postcode ~ '\^\[0-9\]\{4\}\$'/i);
  assert.match(route, /requireApiWorkspace\(request, "self_serve"/u);
  assert.match(route, /guard\.access\.role !== "owner"[\s\S]*guard\.access\.role !== "admin"/u);
  assert.match(route, /z\.object\([\s\S]*workspaceId: z\.string\(\)\.uuid\(\)\.optional\(\)/u);
});
