import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STYLE_EXTRACTOR_VERSION,
  persistStyleProfile,
} from "../src/lib/adstudio/style-profile.ts";
import type { StyleDescriptor } from "../src/lib/adstudio/style-profile.ts";

const migrationPath = "supabase/migrations/202606090002_ad_style_profiles.sql";

// ─── Migration assertions ────────────────────────────────────────────────────

test("style-profile migration is wrapped in a transaction", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /^\s*begin;/im, "migration must start with begin;");
  assert.match(sql, /commit;/i, "migration must end with commit;");
});

test("style-profile migration creates research.ad_style_profiles table", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /create table if not exists research\.ad_style_profiles/i,
    "expected CREATE TABLE for research.ad_style_profiles",
  );
});

test("style-profile migration includes all required columns", () => {
  const sql = readFileSync(migrationPath, "utf8");
  for (const column of [
    "id",
    "media_asset_id",
    "observed_ad_id",
    "source_content_hashes",
    "descriptor",
    "extractor_version",
    "model",
    "decision_id",
    "created_at",
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `expected column ${column}`);
  }
});

test("style-profile migration has FK from media_asset_id to research.media_assets", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /media_asset_id[\s\S]*?references research\.media_assets/i,
    "expected media_asset_id FK to research.media_assets",
  );
});

test("style-profile migration has FK from decision_id to research.agent_decisions", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /decision_id[\s\S]*?references research\.agent_decisions/i,
    "expected decision_id FK to research.agent_decisions",
  );
});

test("style-profile migration creates unique index on media_asset_id", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /create unique index if not exists ad_style_profiles_media_asset_uidx[\s\S]*?on research\.ad_style_profiles\s*\(\s*media_asset_id\s*\)/i,
    "expected unique index on media_asset_id",
  );
});

test("style-profile migration enables RLS and denies public/anon/authenticated direct access", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /alter table research\.ad_style_profiles enable row level security/i);
  assert.match(sql, /revoke all on research\.ad_style_profiles from public, anon, authenticated/i);
  assert.match(sql, /grant all on research\.ad_style_profiles to service_role/i);
  assert.doesNotMatch(
    sql,
    /grant\s+[^;]*on research\.ad_style_profiles to authenticated/i,
    "must not grant authenticated role direct table access",
  );
});

test("style-profile migration expands agent_decisions.decision_type to include style_profile_extraction", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /add constraint agent_decisions_decision_type_check[\s\S]*?style_profile_extraction/i,
    "expected style_profile_extraction in the new decision_type constraint",
  );
  // Must also preserve all prior values
  for (const value of [
    "page_resolution",
    "agent_match",
    "ad_classification",
    "media_capture",
    "watchdog",
    "queue_operation",
  ]) {
    assert.match(
      sql,
      new RegExp(`'${value}'`, "i"),
      `expected pre-existing decision_type value '${value}' preserved`,
    );
  }
});

test("style-profile migration drops the old constraint before adding the new one", () => {
  const sql = readFileSync(migrationPath, "utf8");
  // The DO block locates and drops by content, not hardcoded name
  assert.match(sql, /drop constraint[\s\S]*?decision_type/i);
  assert.match(sql, /add constraint agent_decisions_decision_type_check/i);
  const dropPos = sql.toLowerCase().indexOf("drop constraint");
  const addPos = sql.toLowerCase().indexOf("add constraint agent_decisions_decision_type_check");
  assert.ok(dropPos < addPos, "drop must appear before add");
});

test("style-profile migration does not alter any existing research table columns", () => {
  const sql = readFileSync(migrationPath, "utf8");
  // Allowed: alter table research.agent_decisions (constraint only)
  // Forbidden: any ALTER TABLE on observed_ads, media_assets, ad_creatives, etc.
  assert.doesNotMatch(sql, /alter table research\.observed_ads/i);
  assert.doesNotMatch(sql, /alter table research\.media_assets/i);
  assert.doesNotMatch(sql, /alter table research\.ad_creatives/i);
});

test("extractStyleProfile STYLE_EXTRACTOR_VERSION is a non-empty string", () => {
  assert.equal(typeof STYLE_EXTRACTOR_VERSION, "string");
  assert.ok(STYLE_EXTRACTOR_VERSION.length > 0);
});

// ─── Persistence unit tests ──────────────────────────────────────────────────

function makeMockSupabase() {
  const insertedDecisions: unknown[] = [];
  const insertedProfiles: unknown[] = [];

  function makeChain(store: unknown[], returnId: string) {
    return {
      insert: (row: unknown) => {
        store.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: { id: returnId },
              error: null,
            }),
          }),
        };
      },
    };
  }

  const client = {
    schema: (_name: string) => ({
      from: (table: string) => {
        if (table === "agent_decisions") return makeChain(insertedDecisions, "decision-uuid-1");
        if (table === "ad_style_profiles") return makeChain(insertedProfiles, "profile-uuid-1");
        throw new Error(`Unexpected table: ${table}`);
      },
    }),
    insertedDecisions,
    insertedProfiles,
  };

  return client;
}

test("persistStyleProfile inserts an agent_decisions row before the style profile row", async () => {
  const mock = makeMockSupabase();

  const result = await persistStyleProfile(mock as never, {
    mediaAssetId: "media-asset-uuid",
    observedAdId: "observed-ad-uuid",
    result: {
      descriptor: {
        composition: "centred",
        crop: "medium",
        lighting: "bright",
        time_of_day: "midday",
        palette: ["#fff"],
        mood: "clean",
        lens: "standard",
        do_not_copy: true,
      },
      sourceContentHashes: ["hash-abc"],
      model: "gpt-4-vision",
    },
  });

  assert.equal(result.error, null, `expected no error, got: ${result.error}`);
  assert.equal(mock.insertedDecisions.length, 1, "must insert one agent_decisions row");
  assert.equal(mock.insertedProfiles.length, 1, "must insert one ad_style_profiles row");
});

test("persistStyleProfile sets decision_type to style_profile_extraction", async () => {
  const mock = makeMockSupabase();

  await persistStyleProfile(mock as never, {
    mediaAssetId: "m1",
    observedAdId: "o1",
    result: {
      descriptor: {
        composition: "c",
        crop: "wide",
        lighting: "l",
        time_of_day: "midday",
        palette: [],
        mood: "m",
        lens: "standard",
        do_not_copy: true,
      },
      sourceContentHashes: ["h1"],
      model: "test",
    },
  });

  const decision = mock.insertedDecisions[0] as Record<string, unknown>;
  assert.equal(decision.decision_type, "style_profile_extraction");
  assert.equal(decision.subject_type, "media_asset");
  assert.equal(decision.subject_id, "m1");
});

test("persistStyleProfile links the style profile row to the decisions row via decision_id", async () => {
  const mock = makeMockSupabase();

  const result = await persistStyleProfile(mock as never, {
    mediaAssetId: "m2",
    observedAdId: "o2",
    result: {
      descriptor: {
        composition: "c",
        crop: "medium",
        lighting: "l",
        time_of_day: "midday",
        palette: [],
        mood: "m",
        lens: "standard",
        do_not_copy: true,
      },
      sourceContentHashes: ["h2"],
      model: "test",
    },
  });

  assert.equal(result.decisionId, "decision-uuid-1");
  const profile = mock.insertedProfiles[0] as Record<string, unknown>;
  assert.equal(profile.decision_id, "decision-uuid-1", "profile must reference the decisions row");
});

test("persistStyleProfile stores content hashes but not the imageUrl", async () => {
  const mock = makeMockSupabase();

  await persistStyleProfile(mock as never, {
    mediaAssetId: "m3",
    observedAdId: "o3",
    result: {
      descriptor: {
        composition: "c",
        crop: "wide",
        lighting: "l",
        time_of_day: "midday",
        palette: [],
        mood: "m",
        lens: "wide",
        do_not_copy: true,
      },
      sourceContentHashes: ["hash-xyz-stored"],
      model: "gpt-4v",
    },
  });

  const profile = mock.insertedProfiles[0] as Record<string, unknown>;
  const profileJson = JSON.stringify(profile);
  assert.ok(profileJson.includes("hash-xyz-stored"), "content hash must be stored");
  // No URL fields whatsoever
  assert.ok(!profileJson.includes("http"), "imageUrl must not appear in persisted profile");
  assert.ok(!profileJson.includes(".jpg"), "no image URL in persisted profile");
});

// ─── StyleDescriptor shape contract ─────────────────────────────────────────

test("StyleDescriptor type requires do_not_copy to be the literal true", () => {
  // TypeScript enforces this at compile time; this test documents the contract.
  const d: StyleDescriptor = {
    composition: "test",
    crop: "wide",
    lighting: "overcast",
    time_of_day: "overcast",
    palette: [],
    mood: "calm",
    lens: "standard",
    do_not_copy: true, // any other value is a TS error
  };
  assert.equal(d.do_not_copy, true);
});
