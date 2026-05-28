# Blockwise Hermes Skills

This directory holds the Blockwise-specific skills that get deployed to the
Hermes Agent instance running on the Hostinger VPS. Each skill is a
self-contained folder with a `SKILL.md` describing intent + tools + I/O,
plus any helper scripts.

These skill folders are **uploaded to the Hermes VPS** during deployment
(via Coolify volume mount or a sync step in CI). They are NOT loaded by
the Next.js app at runtime.

## Skills

| Skill                            | What it does                                                              |
| -------------------------------- | ------------------------------------------------------------------------- |
| `blockwise-agent-census`         | Discover agencies and agents from WA licence reg, REIWA, Domain, REA, GBP |
| `blockwise-page-resolver`        | Match an agent/agency to their real Meta Page                             |
| `blockwise-apify-orchestrator`   | Call Apify actors on schedule, hand results to the ingestion worker       |
| `blockwise-ad-classifier`        | Tag every ad creative with type/hooks/style/audience                      |
| `blockwise-coverage-auditor`     | Sample postcodes, browse Meta Ad Library, file defects for gaps           |
| `blockwise-defect-investigator`  | Triggered by operator; reproduces and roots-causes a coverage defect      |
| `blockwise-operator-chat`        | NL queries from Blockwise /operator over research.v_*                     |

## Writing rules every skill MUST obey

1. **No arbitrary SQL.** Skills write to Supabase only via the ingestion
   worker's API (HTTPS, signed). The worker validates payloads with zod
   and enforces the integrity rules.
2. **Every write is a decision.** Anything that changes the database also
   writes a row to `research.agent_decisions` with rationale, confidence,
   evidence, and a model/cost trace.
3. **Source evidence is mandatory.** Every claim cites a URL and a
   `source_documents.id`. No "I think this is right" without evidence.
4. **Provider failure ≠ no ads.** A skill that calls Apify and gets a
   bad response must mark the run failed. It must never call the
   ingestion worker with an empty result claiming "no ads here."
5. **Idempotent.** Re-running a skill with the same input must produce
   the same logical effect, not duplicates.
6. **Postcode confined.** Every skill takes an explicit postcode or
   advertiser_page_id and stays inside it. No global side effects.

## Deployment

Skills are version-pinned in the Hermes config on the VPS. Bumping a
skill version is a one-line config change followed by `coolify redeploy hermes`.
