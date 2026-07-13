# Blockwise AdStudio Completion Plan

Status: active and governing

This is the only active plan for completing and releasing AdStudio. It
preserves the completed Phase 0, Phase 1, and P2.1 work recorded in
`TEMPLATE-FLOW-EXECUTION-PLAN.md` and supersedes every unfinished section of
that plan.

The plan is dependency-gated. It has no calendar promises. Evidence records
must still include capture timestamps, commit SHAs, provider/model identifiers,
and deployment identifiers so freshness and provenance can be proved.

## Architecture decision

AdStudio will complete the clone-first raster architecture. It will not restore
Fabric, a general deterministic compositor, or a general layered document for
new ads.

```text
real source ad
-> independently reviewed, sanitized 4:5 reference
-> independently reviewed, sanitized 9:16 reference
-> customer Brand Pack, photos, and brief
-> one structured copy pass
-> parallel format-specific raster clones
-> blocking critical QA and editable-region detection
-> immutable accepted revisions
-> masked targeted regeneration
-> final-quality revision
-> exact-byte export of the approved revision
```

The integrated raster is the design. Typography, image treatment, texture,
scrims, and composition remain part of the generated image. Launch editing is
limited to declared on-image copy and declared image/logo slots. Feed text and
Meta CTA remain directly editable. Arbitrary drag, resize, and free-canvas
editing are outside the launch contract.

## Transition law

Current V1 templates remain governed by `AGENTS.md` and
`hermes/skills/adstudio-template-builder/SKILL.md`, including canvas/Fabric
lockstep, until the clone package contract, native format references, legacy
reader, and migration path have merged.

V2 clone packages must preserve the non-negotiable product rules while deleting
the obsolete layout representation:

- diversity is measured by AI-extracted `ad_type`, `primary_intent`, and
  `property_or_agent_focus`
- no fixed role list, archetype, shared layout recipe, or layout DSL
- every package derives from one real source ad and records `sourceAd`
- one source ad maps to at most one active template
- the homogenization gate may not be weakened, bypassed, threshold-lowered, or
  special-cased
- photos fit their declared slots through vision plus image editing/outpaint;
  deterministic smart crop remains fallback only

The template-builder skill, `AGENTS.md`, validator, and verifier change in the
same serialized integration as the V2 cutover. No worker may create a V2
template against contradictory V1 instructions.

## Frozen contracts

### TemplatePackageV2

The static package contains only fields with immediate consumers:

```text
identity:
  id
  name
  goal
  offerId
  category
  audienceIntent
  tags
  promptHint

provenance:
  sourceAd
  contentHash
  classification

inputs:
  copyFields[]
  imageSlots[]

formatReferences:
  referenceImages["4:5"]
  referenceImages["9:16"]

gallery:
  thumbnails
  alt

meta:
  Meta lead-ad configuration
```

Both references must consume the same declared on-image copy keys. A template
may declare any number of copy and image slots, including no headline, multiple
images, or a headshot. A missing format reference prevents activation.
Every `copyFields[].key` and `imageSlots[].key` is unique and stable for the life
of the package. Keys are package input identity, not a fixed visual-role list.

The V2 package does not contain `canvas.objects`, `fabricJson`, a general layer
graph, generation seeds, focal-point infrastructure, arbitrary bindings, or a
layout DSL.

### CreativeRevisionV1

An accepted raster revision is append-only and workspace-scoped:

```text
id
workspace_id
creative_id
parent_revision_id
revision_number
storage_bucket
storage_path
content_sha256
mime_type
byte_length
width
height
expected_copy_json
render_copy_hash
qa_json
regions_json
quality_tier
creation_operation
provider_run_id
correlation_id
created_by
created_at
```

Required database invariants:

- unique `(creative_id, revision_number)` and immutable revision rows
- parent revision belongs to the same workspace and creative
- active revision belongs to the same workspace and creative
- storage objects use unique, non-overwriting keys
- stored bytes match the recorded hash, MIME type, dimensions, and byte count
- direct update/delete is revoked or rejected; accepted revisions are appended
- every RLS policy and every workspace-scoped query filters `workspace_id`

`adstudio_creatives.active_revision_id` points to the currently selected
revision. Content-producing operations create revisions. Undo and manual
version selection change the active pointer through compare-and-swap and record
an activation event in the existing audit/event path; they do not mutate or
mislabel an old revision.

### Shared cross-format state

The creative pair has one authoritative desired on-image-copy state:

```text
desired_render_copy_json
desired_render_copy_hash
copy_version
pending_edit_operation_id
```

`desired_render_copy_hash` covers only copy baked into raster images. Feed text
and CTA changes increment their own persisted copy version and do not make
unchanged images stale.

An on-image copy edit first advances the desired state with compare-and-swap,
then creates format-specific revisions linked by one edit operation. Partial
success is persisted honestly. Export is blocked until active Feed and Story
revisions both match the authoritative desired render hash. A failed format can
be retried without discarding the accepted revision for the successful format.

### Compare-and-swap RPC

A narrowly granted `SECURITY DEFINER` RPC with an empty fixed `search_path` and
fully qualified objects serializes desired-state changes, revision creation, and
activation. It derives the authenticated actor, permits an explicit actor only
for service-role jobs, verifies the required workspace role, and accepts no
untrusted ownership identifiers without checking them. Direct authenticated
writes to protected revision/head fields are revoked.

The caller supplies `workspace_id`, variant/edit-group identity, and the expected
active revisions and desired-copy version. The function locks the variant and
creative rows in stable order, validates same-workspace graph ownership, and
returns a conflict without writing when any expectation is stale. Repeating the
same mutation and content is idempotent; reusing a mutation ID for different
content is rejected. Two concurrent writes against one expectation produce one
success and one HTTP 409 at the API boundary.

### Render-kind discriminator

`adstudio_creatives.render_kind` is the owning discriminator, with only
`flat_clone`, `legacy_composite`, and temporary migration-only `unknown` values.
It is populated and transactionally maintained by every writer; application
behavior and snapshot selection never infer kind from object count after
cutover. The expand migration classifies every existing row with the canonical
clone predicate, reports and quarantines ambiguity, and permits no `unknown`
row at read cutover. Changing a row's kind is a privileged, audited transition,
not a normal creative update.

## Release definition

AdStudio is complete only when every criterion below has current evidence.

### Template portfolio

- 12 active templates from 12 unique source-ad hashes
- at least six distinct `primary_intent` values
- no intent has more than three templates
- every template has approved 4:5 and 9:16 references
- no source business name, logo, phone, URL, identity, or watermark survives
  sanitization or customer generation
- no pair is rejected as a look-alike by the independent visual reviewer
- the unmodified homogenization gate passes for the integrated portfolio

### Generation and QA

- at least 95 percent of matrix generations produce usable Feed and Story
  revisions within two attempts
- every accepted ad contains customer-supplied critical fields exactly
- zero accepted outputs contain source identity leakage
- zero accepted outputs contain severe face, property, logo, or text damage
- each format uses its own approved native reference
- critical QA failure or QA unavailability is never presented as ready
- provider, QA, storage, and persistence failures preserve the last accepted
  revision and credit/refund behavior remains explicit
- QA comparison preserves case and punctuation; it may normalize Unicode, line
  endings, and layout-only whitespace but must not lowercase or strip punctuation

Critical blockers include wrong customer text, source identity leakage, wrong
address/price/date/statistic, altered agent identity, material property damage,
unreadable text, unsafe-area violations, and compliance blockers. Aesthetic
concerns that do not change facts or legibility are warnings.

Critical QA is reference-aware and fail-closed. Each QA request includes the
generated candidate; the native sanitized format reference; the original source
ad plus source logo, watermark, and identity exemplars; the customer Brand Pack,
identity, property, and supplied media references; exact expected copy with
critical-field labels; the extracted forbidden-source identity list; safe-area
rules; and the previous accepted revision for edit comparisons. QA returns
severity-coded findings, regions, and an explicit `passed`, `blocked`, or
`unavailable` result. Unavailable never means passed.

One quality attempt means one generated image candidate that reaches QA. The
maximum is two QA-evaluated candidates per format for generation and two per
targeted edit. Provider failures that produce no candidate remain provider
attempts for reliability and cost reporting but are not silently counted as
successful quality attempts. Each quality attempt permits one primary provider
call and, only after a retryable provider failure, one declared fallback call.
There are no hidden same-provider retries. The hard maximum is therefore four
billed image calls per format and operation, with every call and failure
reconciled to its provider run.

### Editing

- at least 95 percent of matrix targeted edits pass within two attempts
- every content-producing edit creates an immutable accepted revision
- zero stale jobs overwrite a later desired state or active revision
- masked edits reject material change outside the approved region
- all expected on-image copy is rechecked after every edit
- undo and version switching survive reload
- field-list editing remains available when visual regions overlap or are absent
- current-format and both-format image replacement behave as selected
- partial cross-format failure is visible and recoverable

### Export

- export reads the exact stored bytes of the approved active final revision
- export performs no design rerender
- exported bytes match recorded hashes, dimensions, MIME types, and byte counts
- Feed and Story match Preview and the authoritative desired render hash
- final revisions have zero critical QA blockers
- ZIP assets are non-empty and correctly dimensioned
- the manifest records template/source provenance, revision IDs, format, render
  hash, copy version, QA result, provider run, and model
- export and publish accept identifiers plus expected revision/version values,
  reload authoritative workspace rows on the server, and never trust a submitted
  client campaign pack as the source of export or publish truth

### Legacy safety

- legacy writes are fenced before the final inventory
- the inventory is an exact creative-ID set, not a count comparison
- every legacy source records a source-canvas hash/version and a verified
  snapshot artifact hash
- every workspace-scoped script query and mutation includes `workspace_id`
- a deployed reader loads legacy snapshots before any renderer is removed
- historical Preview and export use stored snapshots, including required PNG and
  JPEG behavior, without Fabric or SVG fallback
- a final post-fence scan finds zero unsnapshotted or drifted legacy rows
- renderer deletion occurs in a later integration after the reader is proven

### UI and accessibility

- verified at 1440x900, 768x1024, 390x844, and 320-pixel width
- no serious or critical Axe findings
- complete keyboard path, visible focus, and correct focus return
- touch targets are at least 44x44 pixels
- no horizontal overflow
- loading, slow, error, retry, success, partial-success, conflict, disabled, and
  stale-write states are verified
- current `AGENTS.md` Impeccable workflow is recorded for every UI change

### Operations

- `npm run verify:hard-reset`, `npm run typecheck`, `npm test`, and
  `npm run build` pass on the integrated commit
- migrations clean-apply and rollback in a test database
- changed Trigger.dev tasks are deployed and registered
- Vercel Preview paid real loops pass at the required gates
- every paid image/provider run records reconciled non-zero usage and cost when
  the provider charged for work, including failed cascades where billing occurs
- canary thresholds hold for 48 consecutive hours
- production runs the committed release through the normal deployment path
- cleanup leaves no anonymous dirty worktrees or unresolved P0/P1 findings

## Continuous swarm protocol

The coordinator maintains a dependency queue with these states:

```text
blocked-by-dependency -> ready -> running -> scoped-verification
-> independent-review -> integration -> full-verification -> done
                                      -> remediation -> ready
```

Rules:

- use one coordinator/integrator, two implementation workers, and one
  independent reviewer when four slots are available
- every implementation worker uses an isolated worktree and branch, records its
  base SHA, and owns disjoint paths/interfaces
- the coordinator alone owns shared files, migration ordering, template index,
  source-provenance ledger, model profiles, verifier, `AGENTS.md`, skills,
  workflow files, production mutations, and release actions
- workers run scoped tests and commit their work before review
- the reviewer checks the diff, requirements, tests, and scope without editing
- the coordinator integrates one reviewed change at a time and reruns affected
  plus full milestone gates
- after coordinator integration, active workers refresh or rebase onto the new
  integration SHA before their next commit
- paid evidence is keyed by code SHA, model/profile and provider adapter,
  generation/edit/copy/QA prompt hashes, schema version, native references,
  mask calibration, source/package and asset hashes, persistence/export logic,
  harness version, and scoring rubric; any behavior-affecting change invalidates
  every exercised cell downstream of that input
- failures create fix-forward remediation tasks; they quarantine only the
  affected lane while unrelated ready work continues
- safety failures hold their dependency chain: workspace isolation, data loss,
  stale overwrite, source leakage, off-mask drift, copy mismatch, corrupted
  export, or a red required real loop
- no agent lowers a gate, edits another worker's allocation, or bypasses a paid
  or production guard to make progress appear green

### Model routing and dispatch record

Do not commit invented model aliases. Every worker record contains:

```text
runtime-exposed model identifier or "unexposed"
reasoning level
task tier
owned paths
base commit
acceptance criteria
verification commands
independent review count
```

Routing:

- schema, RLS, concurrency, destructive-data decisions, and independent final
  review use the strongest available reasoning model with extra-high reasoning
- normal implementation uses the default production coding model
- frozen mechanical work uses the cheapest capable coding model
- template packages use the production coding model plus an independent visual
  review on the strongest vision-capable model
- deployment uses a deterministic low-cost model only after the diff and
  release evidence are approved
- when the runtime does not expose per-subagent model selection, agents inherit
  the coordinator runtime and record `unexposed`; they never claim an alias as
  an actual model ID

### Required skills

- every template task reads and follows
  `hermes/skills/adstudio-template-builder/SKILL.md`
- every UI task explicitly invokes `$impeccable`; significant UI work runs
  `critique -> craft -> adapt -> harden -> polish`
- every task uses `hermes/skills/blockwise-agent-cleanup/SKILL.md` before handoff,
  PR, or completion
- independent domains are dispatched in parallel only when paths and state do
  not overlap

## Dependency gates

### Gate 0: one plan, fresh baseline, frozen interfaces

1. Merge this plan and mark the previous plan superseded.
2. Capture current repository and production evidence:
   - composited, clone, snapshot, campaign, and workspace counts
   - exact legacy creative IDs and source hashes
   - active template count and intent mix
   - resolved model profiles and observed generation/edit/QA cost
   - Trigger.dev registration and E2E secret readiness
3. Run the legacy script in dry-run mode only after its workspace scoping and
   inventory logic are corrected; no row changes in this gate.
4. Freeze V2, revision, desired-copy, QA, stale-write, render-kind, export,
   migration, and rollback contracts.
5. Complete Impeccable initialization from repository evidence: commit
   `PRODUCT.md`, generate `DESIGN.md` from the existing system, configure live
   mode if safe, and record the product register. The PRODUCT/DESIGN registers
   remain provisional until explicit owner confirmation of their strategic and
   qualitative language before any UI implementation. Non-UI contract and
   safety work may continue meanwhile.
6. Fix image, copy, vision, and QA provider usage/cost recording so paid gates
   and hard caps operate on actual reconciled cost rather than zero-valued or
   incomplete provider runs.

Gate acceptance: one governing plan, no contradictory worker instruction, fresh
evidence, and decision-complete interfaces with no speculative fields. The gate
remains incomplete until the secured exact manifest and its reproducible query,
per-workspace aggregates, source hashes, and evidence SHA are recorded.

### Gate 1: immutable revision foundation

Use expand/deploy/backfill/contract sequencing:

1. Add append-only revisions, active pointers, desired-copy state, constraints,
   RLS, policies, activation audit, and compare-and-swap RPC.
2. Deploy revision-aware dual-write/CAS paths for generation, edit, enhance,
   finalize, undo, activation, draft, and publish; populate and maintain
   `render_kind`; briefly fence any mutator that cannot dual-write safely.
3. Update transactional campaign persistence so every new clone creative is
   born with accepted revision 1 and active pointer in the same transaction.
4. Backfill current clone rows by recorded source version and render-input hash;
   detect missing QA/regions and run region detection or mark the revision
   explicitly non-editable until repaired.
5. Repeat the backfill and prove zero eligible gaps and zero source drift before
   enforcing completeness or removing compatibility reads.
6. Route server-side export and publish through authoritative revision reads;
   reject client-pack, stale-head, cross-workspace, and mismatched-copy requests.
7. Contract old direct mutation paths only after the new readers, writers, and
   backfill invariants are green in Preview and production-safe reads.

Acceptance includes concurrent-write tests, slow-job tests, workspace isolation,
reload-safe undo, immutable-byte checks, migration clean apply/rollback, and the
full repository gates.

### Gate 2: native formats, masked edits, blocking QA

Two workers may operate only after shared interfaces are frozen and path
ownership is disjoint.

- add independent 4:5 and 9:16 references and remove runtime Story recomposition
- require both references for activation and use the stricter copy constraint
- derive masks from the selected QA region with calibrated padding
- route targeted edits only through mask-capable providers
- calibrate an outside-mask perceptual-difference threshold from a recorded
  pilot across text, identity, property, and image regions
- recheck all expected copy and critical visual rules
- provide QA with source/customer references and forbidden-identity evidence so
  identity leakage and factual visual changes are testable
- make critical initial-generation QA blocking with bounded rerolls
- persist desired cross-format edit operations and partial success honestly
- keep Feed/Story generation concurrent after contract resolution

The paid Preview real loop runs after this gate and must pass on desktop and
mobile before dependent work proceeds.

### Gate 3: legacy preservation and renderer retirement

This gate is serialized.

1. Implement and deploy a database-and-API legacy-write fence. It rejects
   custom/multi-object creation and legacy draft, publish, duplicate, delete,
   canvas, identity, or re-parenting writes. The only mutation left open is a
   narrow exactly-one-row compare-and-swap snapshot-finalize transition.
2. Deploy the fallback-compatible legacy snapshot reader and
   server-authoritative exact-byte historical export path before any row is
   finalized.
3. Capture the exact post-fence inventory. Its full render-input hash covers
   workspace, creative, campaign, variant, format, dimensions, canonical canvas,
   Brand Pack typography, and every resolved asset byte.
4. Harden the snapshot tool with explicit workspace predicates and `render_kind`
   selection. Wait for fonts and image decode; fail closed on missing assets;
   write content-addressed objects with `upsert:false`; read each object back and
   verify hash, MIME type, dimensions, and byte count before CAS finalization.
5. Dry-run, execute in bounded batches, retry diagnosed failures, and prove the
   exact identity set with zero drift. A failed batch leaves database pointers
   unchanged and may leave only unreferenced immutable objects for later GC.
6. Activate the snapshot reader and verify historical campaigns across
   workspaces, formats, and Brand Packs on Vercel Preview and production-safe
   reads.
7. Re-run the post-fence zero-pending/zero-drift check.
8. Perform the V2 cutover as one serialized integration: deploy the V2 type,
   parser, and raster runtime; migrate or replace active V1 packages with
   provenance and content-hash verification; switch the active index; and update
   `AGENTS.md`, the template-builder skill, validator, and verifier together.
   Verify Preview and retain a tested switch back to the reader-compatible
   pre-cutover release.
9. Record the verified pre-deletion application SHA and deployment ID, retain
   `canvas_json`, immutable snapshots, and additive schema, and rehearse both
   roll-forward and deployment rollback. The rehearsal must prove a failed
   snapshot batch or cutover leaves active pointers unchanged.
10. In a later reviewed integration, delete Fabric, browser/SVG design renderers,
    custom/blank builder remnants, legacy layout math, duplicate role maps, and
    browser rerender export.
11. Retain the database `canvas_json` column until a separate contraction has a
    row-count/archive plan.

Acceptance: historical preview/export uses snapshots with no renderer fallback,
new creation/edit/export stays green, Fabric is absent from dependencies, and no
rule still requires Fabric lockstep. Rollback evidence identifies a verified
reader-compatible deployment and proves immutable artifacts and source canvas
data survive both roll-forward and rollback paths.

### Gate 4: factory, harness, and three-template pilot

After the V2 cutover:

- build one command that produces an inactive candidate package, both sanitized
  references, classification, source hash, duplicate-source check, and evidence
- build a static gate with self-tests and the preserved semantic-diversity law
- make the integrated launch gate enforce 12 templates, at least six distinct
  AI-classified primary intents, no intent above three templates, and unique
  source content hashes
- build a deliberate paid harness that records scenario, provider/model, cost,
  attempts, QA, leakage, edit results, screenshots, reviewer score, and SHA
- pilot two sources that materially broaden intent beyond the migrated template
- require independent review of hierarchy, typography, photography, credibility,
  and both format compositions; every dimension must score at least 4/5, and any
  reference, sample, asset, or package change invalidates that visual review

For each candidate, the frozen paid matrix is three representative Brand Packs
by three brief fixtures (visual-led, factual-heavy, and long brand/contact) by
two formats: 18 draft format cells. Final-tier coverage is three representative
scenarios across both formats: six final cells. Targeted-edit coverage has four
cells: Feed text, Story text, Feed image, and Story image. Each cell has a durable
checkpoint keyed by all paid-evidence validity inputs plus template, Brand Pack,
brief, format, tier, and operation. Before every provider call the harness
atomically reserves the cell and proves the aggregate dollar cap plus the
derived provider-invocation and time ceilings remain; resume runs only missing
or invalidated cells.

The gallery conveyor cannot start until all three pilot templates pass their
complete matrix, source leakage is zero, and pilot targeted-edit success is at
least 90 percent. Owning pipeline failures are fixed or the candidate is
rejected; gates are never lowered.

### Gate 5: continuous portfolio conveyor

Run two template workers plus one reviewer. Each worker owns one source,
candidate package, two references, sample assets, and evidence manifest. The
coordinator alone owns allocation, source ledger, index, validator, gate, shared
types, model profiles, skills, and activation.

Each candidate follows:

```text
source allocation -> package generation -> static gate -> draft matrix
-> targeted edit checks -> final matrix -> independent review
-> coordinator activation -> integrated portfolio gate
```

Continue until the 12-template release definition passes. UI work may proceed in
parallel only in disjoint worktrees.

### Gate 6: complete edit, finalization, export, and reporting journey

- complete mobile editing, accessible field-list fallback, revision history,
  version activation, per-format progress/retry, slow states, final-quality
  status, reload evidence, and keyboard navigation
- finalize from the current expected revision; discard stale results
- export exact active final bytes with matching hashes and manifest
- extend `research.owned_ad_performance` and the existing Meta Monitor projection
  with template/source revision, creative revision, and format
- keep the already archived legacy performance-import table archived unless a
  separately evidenced migration justifies deletion
- add a workspace-scoped rollout control and immediate template kill switch,
  with authorization, failure-injection, and default-state tests, before canary

Apply the mandatory Impeccable workflow and verify every required viewport on a
Vercel Preview. Run the paid real loop after the integrated 12-template journey.

### Gate 7: canary, release, and cleanup

Enable only the E2E, internal, and named pilot workspaces. Monitor for 48
consecutive hours:

- provider/job failure below 2 percent
- critical QA failure after retries below 5 percent
- targeted-edit success at least 95 percent
- zero stale overwrites, source leaks, or corrupted exports
- median accepted two-format cost below $1.00 and P95 below $2.00

A passing canary also requires at least 20 completed two-format generation
operations, 40 targeted edit operations, one generation/finalize/export journey
for every active template, and at least 100 provider/job terminal events. The
provider/job numerator is terminal failures after deduplication and must satisfy
`failures * 100 < events * 2`. The critical-QA population is the at least 60
generation/edit operations that exhausted or passed bounded attempts; its
blocked numerator must satisfy `blocked * 100 < operations * 5`. Targeted-edit
success uses all at least 40 terminal edits and must satisfy
`passed * 100 >= edits * 95`. Cost percentiles use all at least 20 accepted
two-format generations and nearest-rank P95. Zero-tolerance findings use raw
counts. No rate is rounded before comparison, and volume below any denominator
is inconclusive, not green.

Any behavior-affecting code, configuration, model/profile, provider adapter,
prompt, schema, reference, package/asset, calibration, persistence/export, or
harness/scoring fix restarts the 48-hour soak for its affected population.

Any source identity leak disables the affected template immediately while other
safe lanes continue.

Release requires integrated code review, migrations, Trigger registration,
Vercel Preview evidence, desktop/mobile paid loop, accessibility and network
reports, 12 template manifests, production snapshot evidence, no P0/P1 findings,
the verified pre-deletion deployment and rollback rehearsal, and the repository
cleanup report. Default-enable the completed journey, remove the temporary
rollout flag after the canary passes, retain the template kill switch, publish
the runbook, and record the production commit/deployment.

## Paid verification policy

Resolve the active production model profile and price immediately before each
batch. At the Gate 0 baseline, both active image profiles resolve through
OpenRouter to `google/gemini-2.5-flash-image` with a configured $0.039-per-image
fallback estimate; this is not provider billing truth. Direct OpenAI final
fallback remains materially more expensive. Provider-reported actual cost wins;
the exact dispatched runtime price and unit are the fallback snapshot. Budgets
include copy, vision, retries, fallbacks, failed-but-billed attempts, and
input-image costs as recorded and reconciled by provider runs.

- static gate before paid work
- 120-second abort per provider invocation and five-minute terminal deadline per
  paid cell; a timeout is a recorded failed call, never an untracked retry
- the provider-call maximum in the quality-attempt contract is also the per-cell
  invocation cap
- pilot aggregate cap: $15
- complete 12-template gallery aggregate cap: $50
- no duplicate paid batch by multiple reviewers
- durable resume keys and pre-call reservations prevent rerunning valid cells;
  invalidated checkpoints remain as audit evidence but do not count as current
- coordinator dispatches the manual Vercel Preview workflow at Gate 2, Gate 4,
  Gate 6, and the final candidate
- a cap breach quarantines paid work and records the cause; all safe unpaid work
  continues

## Evidence and completion audit

Every gate records requirements against authoritative evidence. A green narrow
test does not prove a broad requirement. Missing, stale, indirect, or uncertain
evidence means the requirement is incomplete.

The coordinator may declare completion only after auditing every named contract,
criterion, command, migration, task registration, runtime route, template
manifest, paid gate, canary threshold, deployment, and cleanup item against the
current integrated production commit.
