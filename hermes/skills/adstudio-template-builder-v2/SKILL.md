---
name: adstudio-template-builder-v2
description: "Execute Frank Ad Studio's durable template-pack build job (Tool runs only; multi-variant packs, subject-invariance gates, release law)."
---

# adstudio-template-builder-v2

## Purpose

Execute Frank Ad Studio's private, durable template-build job. This skill is
only for a `schema://hermes.tool-run-command/v1` Tool run. It must never create
or continue a chat.

## Runtime

- The dedicated, committed builder checkout is `/opt/ad-template-builder`.
- Run every builder command from that directory with its locked Node runtime.
- The canonical gallery is `src/lib/adstudio/template-gallery-v2` and the
  canonical assets are `src/lib/adstudio/template-assets-v2`. Never look for
  an unversioned `template-gallery` or `template-assets` directory.
- Inputs are private paths supplied by the Tool controller. Outputs remain
  beneath Hermes' private Tool asset, checkpoint, and release directories.
- The Tool run's pinned model-policy revision is authoritative. Do not inherit
  a Hub/chat model, change a started stage's route, or invent current pricing.

## Pipeline

### Initial 20-template portfolio lane

When the brief contains `initial-portfolio-id:NNN`, it selects exactly one of
the approved launch templates (`006`, `021`, `033`, `039`, `044`, `062`,
`108`, `111`, `127`, `143`, `145`, `148`, `149`, `154`, `159`, `176`,
`180`, `182`, `194`, `199`). The Tool controller must associate exactly one
private source attachment with that ID. Build it as one durable, visible Frank
run by executing:

`node scripts/adstudio/v2/initial-portfolio-runner.mjs --id NNN --source <privateSourcePath> --out <thisRunPrivateAssetsRoot>`

The runner verifies the pinned source SHA-256, then uses the committed explicit
art-direction contract to create one source-free layered template with native
Feed and Story documents. The source is evidence only: its pixels, identity,
copy, logos, people, URLs, and contact details must never enter the candidate.
The committed portfolio specs, safe fixtures and any prior local candidate are
SEEDS only. Preserve their hash as `seedSha256` and reuse their layered art
direction, but never import their `qa`, `ready`, approval, score or release
state. A seed has no durable-run authority; every accepted generation begins
inside this run and is bound to this run's private source hash.
Do not replace this lane with the generic five-variant skeleton generator, and
do not combine the 20 attachments into one invisible bulk run. Continue with
the deterministic check, subject-invariance, and Studio QA stages below for
that one candidate. Stop with
`release_status: "blocked_pending_human_approval"`; this command never grants
approval or releases a pack.

Run and checkpoint these stages in order:

1. `source`: verify the private source ref and hash.
2. `analyse`: extract the source contract with the configured vision chain.
3. `decompose`: run `node scripts/adstudio/v2/ingest.mjs decompose --id <id>`.
4. `variant-pack` (ONLY when the brief requests a pack of N>1 templates):
   write the analysis contract JSON, then run
   `node scripts/adstudio/v2/variant-pack.mjs --contract <path> --repo <candidateRoot> --source <sourcePath>`.
   This produces EXACTLY N complete layered variants — never fewer. Every
   variant declares `provenance.packId` + `packVariantIndex` (1..N), ships
   native 4:5 feed and 9:16 story formats, its own source-free plates, all
   editable inputs, the full Meta publish block, evidence, and a
   deterministic sample. The script COPIES the committed subject-invariance
   corpus (`public/adstudio-samples`) into the candidate root as regular
   files — never symlinks — and fails fast if the corpus is missing.
5. `restyle`: sanitize identity, copy, palette, assets, and source-photo slots.
6. `story-draft`: run the deterministic story layout command (variants from
   variant-pack already carry native story layouts).
7. `render`: create fresh native Feed and Story previews and hash each preview
   plus their render set. Initialize this run's private generation trace with:
   `node scripts/adstudio/v2/generation-trace.mjs init --trace <privateTraceFile> --template <id> --source-sha <sourceSha256> [--seed-sha <seedSha256>]`.
8. `visual-review`: run two independently attributable visual reviews against
   the source design system, excluding replaceable subject pixels, source
   identity and copy wording. Record EVERY render with:
   `node scripts/adstudio/v2/generation-trace.mjs record --trace <privateTraceFile> --feed-sha <sha256> --story-sha <sha256> --render-set-sha <sha256> --primary-reviewer <stableId> --strict-reviewer <differentStableId> --primary-score <0..10> --strict-score <0..10> --revision-reason <specificDelta>`.
   Emit durable safe events `generation-started`, `generation-rendered`, and
   `generation-scored`. If either score is below 9.5, emit
   `generation-revision-requested`, revise the layered document (never paint a
   flattened replacement), return to `render`, and preserve the prior
   generation. When both scores are at least 9.5, emit `generation-accepted`
   and continue. Never copy a previous score, average the two scores, use one
   reviewer identity twice, or manufacture a passing value. The trace is
   capped at 30 generations; exhaustion is a failed/attention run, never an
   approval bypass.
9. `check`: run the deterministic builder check for EVERY variant
   (`ADSTUDIO_GALLERY_V2_DIR` etc. pointed at the candidate root; the gate is
   pack-aware: declared pack variants share one source hash legitimately, and
   every variant must have a distinct layout skeleton).
10. `subject-invariance`: for the CLI entrypoint run
   `node scripts/adstudio/v2/subject-invariance.mjs --id <id> --out <dir>`
   for EVERY variant. If a candidate root outside the builder checkout is used,
   call the exported `runSubjectInvariance({ repoRoot, templateId, outDir })`
   from a small private Tool-assets script, because the direct CLI defaults
   `repoRoot` to the committed builder checkout. The gate uses the committed,
   versioned fixture corpus (FIXTURE_CORPUS_VERSION) at full strength.
11. `studio-qa`: return previews, the accepted generation trace and evidence
   for all variants, then stop for
   Frank approval.
12. `ready`: after 100% zoom approval, rerun every release gate.
13. `release`: write the immutable pack beneath
    `$HERMES_HOME/tool_releases/ad-template-generator` and return its receipt.

The analyse stage uses the configured vision route to write the builder's
evidence and layered draft contracts; it is not a deterministic CLI
subcommand. If a deterministic command rejects the resulting candidate, stop
and report the evidence; never make the model simulate a passing result.

## Image-model boundary

An image model may change pixels only inside a declared text-cleanup mask or an
explicit optional story-margin extension mask. Never ask a model to paint,
clone, or recreate a whole ad. Pixels outside a mask are immutable during that
attempt. Decomposition, variant generation, rendering, hashing, validation,
subject-invariance, and packaging are deterministic VPS work and make no model
calls.

## Final result contract (candidate stage)

After `studio-qa` previews are prepared, STOP before release for human
approval and return ONE compact JSON object with EXACTLY these semantics
(the Tool framework validates them verbatim):

- `template_id` — the pack id.
- `candidate_ref` — a `.json` FILE path (e.g. the variant-pack manifest)
  beneath THIS run's `tool_assets/.../runs/<run_id>` or `tool_checkpoints/<run_id>`
  roots. Never a directory; never a path outside the private run roots.
- `preview_refs` — a non-empty array of IMAGE files (`png/jpg/webp`) located
  under `tool_assets/.../runs/<run_id>/previews/`. Copy the per-variant
  portrait + story previews there (never reference candidate/public paths).
- `evidence_refs` — the analysis, check, variant-pack manifest, template docs,
  accepted generation trace, subject-invariance evidence, and contact sheets.
- `generations` — the complete ordered array copied from the validated
  `adstudio.generation-trace.v1` record. Each item contains immutable Feed,
  Story and render-set hashes, independent reviewer IDs, both numeric scores,
  the decision and the specific revision reason.
- `qa_summary` with the EXACT literal values:
  - `source_verified: true`
  - `deterministic_check: "passed"`
  - `subject_invariance_gate: true` (after all N variants pass the gate)
  - `visual_review.likeness_threshold: 9.5`
  - `visual_review.scores.primary_ad_system_likeness: <accepted score>`
  - `visual_review.scores.strict_ad_system_likeness: <accepted score>`
  - `visual_review.generation_trace_sha256: <validated trace SHA-256>`
  - `release_status: "blocked_pending_human_approval"` (exact string)
- `cost` and `attention` items.

The framework hard-fails the run if any value differs. Never mark a gate
passed when it did not pass; if a gate fails, report it and stop.

## Finalize / hard-reset recipe (after human approval)

Re-open the approved checkpointed workspace and rerun EVERY release-blocking
check from the committed state, WITHOUT writing into the read-only authority
checkouts (/opt/ad-template-builder, any Git checkout — read-only by
contract):

1. `node scripts/verify/adstudio-templates-v2.mjs` (fast mode) against the
   candidate dirs — schema/contract/publish/diversity + tofu gate.
2. Subject-invariance gate per variant (fresh outDir) — source-free proof.
3. `npm run typecheck` — the canonical typecheck is NON-WRITING
   (`tsc --noEmit --incremental false`); it must pass from the read-only
   checkout and must never write build-info files.
4. `node scripts/verify/hard-reset-static.mjs` — static clean-rebuild
   verification (the fixture corpus path is a committed dependency, not
   legacy).

Only when every check passes, issue the immutable signed TemplatePack via
`pack-release.mjs` and return the release JSON (release_id,
template_pack_ref, template_pack_path, sha256, signature, compatibility, qa,
trace_ref). The release store is ALWAYS `$HERMES_HOME/tool_releases/
ad-template-generator` (fallback `~/.hermes/tool_releases/...` when
HERMES_HOME is unset) — NEVER bare `$HOME/tool_releases`. The framework
rejects any template_pack_path outside that store, and any old release
directory under the wrong path must be deleted before a retry or the agent
will echo its stale path. `template_pack_path` must be the packager's
`packBundle` value (a `.json`/`.zip` file under the store), `sha256` must
hash those exact bytes, and `signature` must be the packager's
`integrity.signature` RECEIPT OBJECT verbatim — never a bare hex string.

CRITICAL — the framework fields are NOT redacted: return the REAL absolute
`template_pack_path` (e.g. `/home/hermes/.hermes/tool_releases/...`), the
real `sha256`, and the real `signature` object EXACTLY as the packager's
stdout produced them. Do NOT replace the path with a placeholder, scheme
prefix (like `hermes-private:`), `{HERMES_HOME}` variable, or any masked
form — the framework resolves the path against the private store and
rejects the release if it is missing or rewritten. "Never expose private
paths" in the controller prompt refers to the returned pack contents,
evidence, and event data — NOT to the framework's own
`template_pack_path` field, which is validated internally and never shown
to customers. A redacted or rewritten path is the single most common
finalize failure; echo the packager's stdout verbatim.
If a check is stale or fails, return `failed=true` with the
error — never weaken or skip a gate.

## Visual-output gate (tofu / missing glyphs)

The verify gate (scripts/verify/adstudio-templates-v2.mjs section 8.5) scans
every 4:5 and 9:16 sample and FAILS the run if any rendered text layer shows
tofu (.notdef boxes) or a declared face lacks the codepoints the doc renders.
The font corpus (public/fonts/adstudio, pinned in manifest.json) is a
VERSIONED dependency: do not ship, re-encode, or subset faces; if a face is
damaged, repair it through the documented corpus process (replace with a
Google Fonts face, verify Latin coverage incl. '@' '>' digits, repin the
manifest sha256) — never weaken the gate. Every variant must ship BOTH
placement samples (provenance.sample + provenance.storySample).

## Release stage (after 100% zoom approval)

The operator's approval finalizes the run. Rerun every release gate, then
issue ONE immutable, sanitized, signed TemplatePack beneath
`$HERMES_HOME/tool_releases/ad-template-generator` via
`node scripts/adstudio/v2/pack-release.mjs` (or equivalent), and return one
JSON object with `release_id`, `template_pack_ref`, `template_pack_path`,
`sha256`, `signature`, `compatibility`, `qa`, and `trace_ref`. The artifact
must be a `.json` or `.zip` file under the release store whose bytes hash to
`sha256` and whose `integrity.signature` equals the returned `signature`.

The returned `qa` object MUST contain these EXACT keys (the framework
validates them verbatim and fails the release otherwise):

- `qa.all_gates_passed` — MUST be boolean `true`
- `qa.subject_invariance_passed` — MUST be boolean `true`
- `qa.source_identity_leakage` — MUST be the integer `0`

Extra descriptive keys (per-gate "passed" strings, evidence paths, etc.)
are fine to include, but those three exact keys with those exact values are
mandatory. Do not return `qa` as a list of per-gate strings or a
human-readable summary — the framework reads the three boolean/int fields
directly.

Observed finalize failure modes (all fixed in the codebase, listed so they
are never reintroduced): (1) `HERMES_HOME` unset in the Tool-run env makes
a `HERMES_HOME || HOME` default write the pack under bare `$HOME/
tool_releases` — resolved via `resolveReleaseStoreRoot` (~/.hermes
fallback); (2) the agent self-redacting `template_pack_path` into a
placeholder (e.g. `hermes-private:`) because the controller prompt says
"never expose private paths" — the framework fields are NOT redacted, echo
the packager stdout verbatim; (3) returning `qa` without the three
mandatory keys above.

## Release law

Release only a provider-neutral TemplatePack with Feed and Story layouts,
layered document, editable image/text contracts, copy/CTA/form contracts,
safe assets and previews, model-policy and trace provenance, QA and
subject-invariance evidence, sanitization receipt, 100% zoom approval,
checksum, and Ed25519 signature receipt. A multi-variant pack releases all N
variants together with its pack manifest (`variant-pack.manifest.json`).

Exclude raw sources, replaceable source-photo pixels, advertiser identity,
private prompts, credentials, reviewer identity, temporary URLs, drafts, and
internal paths. Return only the compact redacted Tool result requested by the
controller. Hidden reasoning and unrestricted command output are never part of
events or the pack.
