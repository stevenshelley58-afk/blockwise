import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AGENT_PERSONAS,
  agentPersonaByKey,
  buildAgentPortraitPrompt,
  generateSyntheticAgentPortrait,
  persistSyntheticAgent,
  type AgentPersona,
} from "../src/lib/adstudio/synthetic-agents.ts";
import { createDeterministicImageProvider } from "../src/lib/adstudio/providers.ts";

const migrationPath = "supabase/migrations/202606090003_synthetic_agents.sql";

// ─── Migration assertions ────────────────────────────────────────────────────

test("synthetic-agents migration is wrapped in a transaction", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /^\s*begin;/im, "migration must start with begin;");
  assert.match(sql, /commit;/i, "migration must end with commit;");
});

test("synthetic-agents migration creates research.synthetic_agents table", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /create table if not exists research\.synthetic_agents/i,
    "expected CREATE TABLE for research.synthetic_agents",
  );
});

test("synthetic-agents migration includes required columns", () => {
  const sql = readFileSync(migrationPath, "utf8");
  for (const col of [
    "id",
    "persona_key",
    "seed",
    "gender",
    "age_range",
    "attire",
    "setting",
    "portrait_storage_path",
    "is_synthetic",
    "not_a_real_person",
    "generated_at",
    "metadata",
    "created_at",
    "updated_at",
  ]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`, "i"), `expected column ${col}`);
  }
});

test("synthetic-agents migration has CHECK constraints enforcing is_synthetic=true and not_a_real_person=true", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /check\s*\(\s*is_synthetic\s*=\s*true\s*\)/i,
    "expected CHECK (is_synthetic = true)",
  );
  assert.match(
    sql,
    /check\s*\(\s*not_a_real_person\s*=\s*true\s*\)/i,
    "expected CHECK (not_a_real_person = true)",
  );
});

test("synthetic-agents migration enables RLS and denies public/anon/authenticated direct access", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /alter table research\.synthetic_agents enable row level security/i);
  assert.match(sql, /revoke all on research\.synthetic_agents from public, anon, authenticated/i);
  assert.match(sql, /grant all on research\.synthetic_agents to service_role/i);
  assert.doesNotMatch(
    sql,
    /grant\s+[^;]*on research\.synthetic_agents to authenticated/i,
    "must not grant authenticated role direct table access",
  );
});

test("synthetic-agents migration creates unique index on persona_key", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /create index if not exists[\s\S]*?on research\.synthetic_agents\s*\(\s*persona_key\s*\)/i,
    "expected index on persona_key",
  );
});

// ─── AGENT_PERSONAS catalogue ────────────────────────────────────────────────

test("AGENT_PERSONAS has exactly 12 entries", () => {
  assert.equal(AGENT_PERSONAS.length, 12);
});

test("AGENT_PERSONAS all have unique personaKeys", () => {
  const keys = AGENT_PERSONAS.map((p) => p.personaKey);
  const unique = new Set(keys);
  assert.equal(unique.size, keys.length, "personaKeys must all be unique");
});

test("AGENT_PERSONAS all have unique seeds", () => {
  const seeds = AGENT_PERSONAS.map((p) => p.seed);
  const unique = new Set(seeds);
  assert.equal(unique.size, seeds.length, "seeds must all be unique");
});

test("agentPersonaByKey returns a map with all 12 personas", () => {
  const map = agentPersonaByKey();
  assert.equal(map.size, 12);
  for (const persona of AGENT_PERSONAS) {
    assert.ok(map.has(persona.personaKey), `missing key: ${persona.personaKey}`);
    assert.deepEqual(map.get(persona.personaKey), persona);
  }
});

// ─── buildAgentPortraitPrompt ────────────────────────────────────────────────

test("buildAgentPortraitPrompt includes 'fictional' and 'unnamed' disclaimers", () => {
  const persona = AGENT_PERSONAS[0]!;
  const prompt = buildAgentPortraitPrompt(persona);
  assert.match(prompt, /fictional/i, "prompt must contain 'fictional'");
  assert.match(prompt, /unnamed/i, "prompt must contain 'unnamed'");
});

test("buildAgentPortraitPrompt includes AU real estate context", () => {
  const persona = AGENT_PERSONAS[0]!;
  const prompt = buildAgentPortraitPrompt(persona);
  assert.match(prompt, /Australian/i, "prompt must reference Australian context");
});

test("buildAgentPortraitPrompt includes persona attire and setting", () => {
  const persona: AgentPersona = {
    personaKey: "test",
    seed: 9999,
    gender: "female",
    ageRange: "30-40",
    attire: "silver-trim blazer",
    setting: "Perth rooftop garden",
  };
  const prompt = buildAgentPortraitPrompt(persona);
  assert.match(prompt, /silver-trim blazer/i, "prompt must include attire");
  assert.match(prompt, /Perth rooftop garden/i, "prompt must include setting");
});

test("buildAgentPortraitPrompt does not include phone numbers or logos instructions (no PII cues)", () => {
  for (const persona of AGENT_PERSONAS) {
    const prompt = buildAgentPortraitPrompt(persona);
    assert.match(
      prompt,
      /phone numbers/i,
      "prompt must explicitly prohibit phone numbers",
    );
    assert.match(
      prompt,
      /logos/i,
      "prompt must explicitly prohibit logos",
    );
  }
});

// ─── generateSyntheticAgentPortrait ─────────────────────────────────────────

test("generateSyntheticAgentPortrait calls provider with persona seed", async () => {
  const receivedSeeds: number[] = [];
  const provider = {
    ...createDeterministicImageProvider(),
    generate: async (input: { seed?: number; [k: string]: unknown }) => {
      receivedSeeds.push(input.seed ?? -1);
      return {
        assetUrl: "https://storage.test/portrait.png",
        seed: input.seed ?? 0,
        model: "test-image-model",
        providerMetadata: {},
      };
    },
  };

  const persona = AGENT_PERSONAS[0]!;
  const result = await generateSyntheticAgentPortrait(persona, provider);

  assert.equal(receivedSeeds[0], persona.seed, "must use persona.seed");
  assert.equal(result.personaKey, persona.personaKey);
  assert.equal(result.seed, persona.seed);
  assert.equal(result.assetUrl, "https://storage.test/portrait.png");
});

test("generateSyntheticAgentPortrait uses 1:1 aspect ratio", async () => {
  const receivedAspects: string[] = [];
  const provider = {
    ...createDeterministicImageProvider(),
    generate: async (input: { aspectRatio: string; [k: string]: unknown }) => {
      receivedAspects.push(input.aspectRatio);
      return { assetUrl: "asset://x.png", seed: 0, model: "test", providerMetadata: {} };
    },
  };

  await generateSyntheticAgentPortrait(AGENT_PERSONAS[0]!, provider);
  assert.equal(receivedAspects[0], "1:1", "portrait must be 1:1 aspect ratio");
});

// ─── persistSyntheticAgent ───────────────────────────────────────────────────

function makeMockSupabase() {
  const upsertedRows: unknown[] = [];

  return {
    schema: (_name: string) => ({
      from: (_table: string) => ({
        upsert: (row: unknown, _opts?: unknown) => {
          upsertedRows.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: "agent-uuid-1" }, error: null }),
            }),
          };
        },
      }),
    }),
    upsertedRows,
  };
}

test("persistSyntheticAgent upserts with is_synthetic=true and not_a_real_person=true", async () => {
  const mock = makeMockSupabase();
  const persona = AGENT_PERSONAS[0]!;

  const result = await persistSyntheticAgent(mock as never, {
    persona,
    portraitStoragePath: "workspace-artifacts/portraits/f-35-professional-office.png",
    model: "gpt-image-2",
  });

  assert.equal(result.error, null, `expected no error, got: ${result.error}`);
  assert.equal(result.agentId, "agent-uuid-1");
  assert.equal(mock.upsertedRows.length, 1);

  const row = mock.upsertedRows[0] as Record<string, unknown>;
  assert.equal(row.is_synthetic, true, "is_synthetic must be true");
  assert.equal(row.not_a_real_person, true, "not_a_real_person must be true");
  assert.equal(row.persona_key, persona.personaKey);
  assert.equal(row.seed, persona.seed);
});

test("persistSyntheticAgent upserts on persona_key conflict (idempotent)", async () => {
  const upsertOpts: unknown[] = [];

  const mock = {
    schema: (_: string) => ({
      from: (_t: string) => ({
        upsert: (row: unknown, opts: unknown) => {
          upsertOpts.push(opts);
          return {
            select: () => ({
              single: async () => ({ data: { id: "agent-uuid-2" }, error: null }),
            }),
          };
        },
      }),
    }),
  };

  await persistSyntheticAgent(mock as never, {
    persona: AGENT_PERSONAS[1]!,
    portraitStoragePath: "path/to/portrait.png",
    model: "gpt-image-2",
  });

  const opts = upsertOpts[0] as Record<string, unknown>;
  assert.equal(opts.onConflict, "persona_key", "must upsert on persona_key conflict");
});
