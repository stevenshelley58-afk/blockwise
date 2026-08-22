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
7. `check`: run the deterministic builder check for EVERY variant
   (`ADSTUDIO_GALLERY_V2_DIR` etc. pointed at the candidate root; the gate is
   pack-aware: declared pack variants share one source hash legitimately, and
   every variant must have a distinct layout skeleton).
8. `subject-invariance`: for the CLI entrypoint run
   `node scripts/adstudio/v2/subject-invariance.mjs --id <id> --out <dir>`
   for EVERY variant. If a candidate root outside the builder checkout is used,
   call the exported `runSubjectInvariance({ repoRoot, templateId, outDir })`
   from a small private Tool-assets script, because the direct CLI defaults
   `repoRoot` to the committed builder checkout. The gate uses the committed,
   versioned fixture corpus (FIXTURE_CORPUS_VERSION) at full strength.
9. `studio-qa`: return previews and evidence for all variants, then stop for
   Frank approval.
10. `ready`: after 100% zoom approval, rerun every release gate.
11. `release`: write the immutable pack beneath
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
  subject-invariance evidence, and contact sheets.
- `qa_summary` with the EXACT literal values:
  - `source_verified: true`
  - `deterministic_check: "passed"`
  - `subject_invariance_gate: true` (after all N variants pass the gate)
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
