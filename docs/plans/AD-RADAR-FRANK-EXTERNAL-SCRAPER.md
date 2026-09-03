# Ad Radar product build with an external scraper engine

Status: approved implementation handoff
Last verified: 2026-09-03 (Australia/Perth)
Execution style: sequential at contract boundaries; parallel only where explicitly shown
Companion contract: `docs/plans/AD-RADAR-SCRAPER-ENGINE-INTERFACE.md`
Review: approved after request-recipe/coverage amendment; no open P0/P1 blockers (2026-09-03)

## Instruction to the implementing agent

Read this complete plan and the companion scraper-interface plan before editing. Work in numbered order and update the progress ledger after every gate. Do not implement a scraper, browser automation, proxy pool, CAPTCHA handling, provider selector, Meta request strategy, or media crawler. Steven owns that separate engine.

You own the rest of the product. “Waiting for the scraper” is not permission to leave the database, Hermes workflow, Frank APIs, UI, tests, fixtures, deployment, or migration unfinished. Build against the strict stub and contract harness, then perform the real-engine acceptance step when Steven supplies an endpoint and credential alias.

If a requirement conflicts with an exact repository `AGENTS.md`, follow the repository rule and record the deviation. Never fake a passed capture, QA receipt, approval, or release.

## Objective

Build Ad Radar as a complete first-class app inside Frank, backed by Hermes Tool Runs and the existing research data plane. The product must be fully functional except for source acquisition, which is delegated through one private versioned adapter to Steven’s standalone Apify-style scraper engine.

The main build owns:

- every canonical/product database table, migration, durable identifier and canonical data-retention policy;
- all Hermes run creation, scheduling, pause/resume/cancel/retry, events and approvals;
- the runtime pipeline around acquisition;
- normalization, creative identity/versioning, classification, media validation, QA, quarantine, accuracy audit and release publishing;
- Frank authentication, project scope, API proxy/projection, SSE and UI/UX;
- connection configuration, health presentation, operational actions, observability, backup, migration, deployment and rollback;
- the scraper API contract, consumer client, deterministic test server and conformance suite.

The external scraper engine owns only:

- public-source page/advertiser resolution requested by the main system;
- browser/API acquisition, pagination and provider-version details;
- proxy/session/rate-limit/anti-bot mechanics;
- downloading source media and raw evidence into its temporary run dataset;
- truthful acquisition logs, counters, warnings and checksums;
- temporary artifact serving until the main runtime imports and acknowledges them.
- its isolated operational PostgreSQL run ledger, outbox, leases/fences and cleanup receipts, plus disposable Redis delivery/visibility mirrors—without canonical Ad Radar credentials or authority.

## Hard ownership boundary

| Concern | Owner | Forbidden owner |
| --- | --- | --- |
| Operator authentication and project access | Frank + Hermes | scraper |
| Run and schedule creation | Hermes | Frank browser, runtime, scraper |
| Immutable settings revision | Hermes | scraper |
| Canonical research database | Ad Radar runtime | scraper, Frank |
| Source acquisition | external scraper engine | Frank, Hermes core |
| Temporary scrape dataset/artifacts | scraper | Frank browser |
| Private scraper run ledger/queues/leases | scraper | canonical runtime, Frank |
| Canonical evidence/media import | Ad Radar runtime | scraper |
| Normalization/classification/QA | Ad Radar runtime | scraper |
| Approval and publish authority | Hermes | runtime alone, scraper |
| Public/safe projection | Frank backend | scraper |
| Customer release consumption | optional Blockwise read model | scraper |

The scraper never receives a canonical Ad Radar database credential and never writes canonical tables; its PostgreSQL/Redis are isolated operational stores only. Frank never calls the scraper from browser JavaScript or directly from a browser-facing route. “Plugged into Frank” means the operator configures and triggers it in Frank while the trusted chain remains Frank → Hermes → runtime → scraper.

## Target architecture

```text
Authenticated operator
  -> Frank /ad-radar UI
    -> Frank /api/ad-radar/*
      -> Hermes /v1/tool-runs/*
        -> installed Ad Radar executor plugin
          -> Ad Radar runtime
            -> canonical research DB + Storage
            -> ScraperPort
              -> ExternalScraperClient
                -> Steven's private scraper gateway
                  -> temporary sealed dataset + artifacts
            -> normalize/classify/QA/quarantine/publish
      <- safe events, projections and actions
```

## How it is triggered

### Manual run

1. Operator selects a Frank project and opens Ad Radar.
2. Frank loads live capabilities, current immutable settings revision, connection health and valid actions.
3. Operator selects sources/bounds and presses `Run radar`.
4. Frank validates CSRF/input, derives the authenticated principal and project server-side, and sends a Tool Run command to Hermes.
5. Hermes authorizes `(principal, project, run)` and durably records the run, settings revision/digest, idempotency key and first event.
6. Hermes dispatches ordered stages to the Ad Radar plugin/runtime.
7. When acquisition is required, runtime creates one bounded scraper operation through `ScraperPort`.
8. Runtime polls events/status, imports the sealed dataset and artifacts, acknowledges successful import, and continues canonical processing.
9. Frank displays declared versus observed progress through SSE.
10. Publication stops at an explicit human approval bound to checksum and settings revision.

### Scheduled run

1. Operator creates/activates a schedule in Frank.
2. Hermes stores the schedule and settings revision; no cron exists in Frank or the scraper.
3. Hermes deduplicates a tick, creates the same Tool Run used by manual execution and follows the identical pipeline.

### Retry or recapture

1. Operator chooses the action in Frank.
2. Hermes validates current state and expected version/checkpoint.
3. Runtime reconciles any existing scraper operation before creating another.
4. A transport retry repeats the exact request bytes and idempotency key. A stage retry keeps the same `logical_acquisition_id` but creates a new `stage_attempt_id` and scraper mutation key after reconciliation. An operator recapture creates a new `logical_acquisition_id`. None may duplicate canonical observations or media.

### Connection test

Frank sends an audited action through Hermes. Runtime calls authenticated scraper `/versions` without a version header, selects a supported compatible version, then calls `/v1/health` and `/v1/capabilities`; it verifies authentication, capability/profile revision and availability, then stores only a safe health receipt. It does not run a scrape.

## Definition of done

- Frank serves a complete Ad Radar app at `/ad-radar` with dashboard, runs, live timeline, library, creative inspector/compare, attention queue, schedules, settings/connections, health, approval and release views.
- Manual, scheduled, retry and recapture flows use Hermes as the sole durable control plane.
- The main repositories contain no actual provider scraping implementation.
- The scraper adapter is a narrow replaceable port with versioned schemas and consumer-driven conformance tests.
- Every imported dataset carries a recipe/schema fingerprint, requested/effective scope hashes, explicit coverage/stop reason and a deterministic sealed checksum; unrecognized source structure fails closed.
- Test/dev can run end-to-end against a synthetic fixture stub, but production refuses fixture mode and cannot publish synthetic data.
- Production reports `scraper_not_configured` or `scraper_unavailable` truthfully until the real engine is installed.
- The real engine can be connected without a Frank UI rewrite, database rewrite or Hermes-core change.
- All canonical data, evidence, media, QA, classifications, approvals and releases are persisted by the main build.
- No raw payload, private artifact URL, credential, prompt, contact/prospect data or local path reaches Frank/public release.
- A bounded real canary through Frank captures at least one real ad using Steven’s engine and reaches approval/release with reconciled data.
- Blockwise execution ownership is removed only after that canary succeeds.

## Repositories and starting state

- Frank prototype: `C:\Dev\.worktrees\frank-ad-radar`, branch `codex/ad-radar-overhaul`.
- Hermes prototype: `C:\Dev\.worktrees\hermes-ad-radar`, branch `codex/ad-radar-tool-runs`; this divergent branch is donor-only and must never be merged/rebased/squashed onto current Hermes.
- Blockwise donor: `C:\Dev\Blockwise`; use CodeGraph first when `.codegraph` exists.
- New main runtime repository: `C:\Dev\ad-radar-runtime`, private `stevenshelley58-afk/ad-radar-runtime`.
- Production: Frank `/projects/frank`, central Hermes `/projects/only-process-hermes`, Blockwise `/projects/blockwise`, research plane `/opt/blockwise`.
- Separate scraper repository/path is owned by Steven and intentionally unspecified here.

## Dependency graph and parallelism

```text
M0 Preserve prototypes and record baselines ------------------\
scraper S-1 bounded acquisition feasibility spike ------------+-> M1 Freeze ownership + Hermes Executor/Runtime v1 + Scraper API v1 contracts
    -> M2 Extract runtime and design canonical DB
      -> M3 Implement ScraperPort, client, stub and conformance harness
        -> M4 Build Hermes control plane ---------\
        -> M5 Build canonical processing pipeline -+-> M6 Build operational APIs/actions
            -> M7 Build Frank backend and trigger flows
              -> M8 Build and finish Frank UI/UX
                -> M9 Stub-backed full integration

Scraper S-1 may run in parallel with main M0, but M1 cannot freeze the provider contract until both finish. After M1, Steven may execute companion S0-S8 in parallel. M4 and M5 may run in parallel only after M1 freezes the Hermes Executor/Runtime contract and M3 freezes the runtime-side ports; M6 depends on both. All other main steps remain sequential.

M9 + scraper S8
  -> M10 / scraper S9 jointly accept the real scraper
    -> M11 / scraper S10 rehearse production data
      -> M12a backup/freeze/migrate + deploy writer-disabled runtime identity
        -> scraper S11 promotes/verifies accepted production engine
          -> M12b deploy control/UI, activate writer, canary and schedule
            -> M13 Remove Blockwise execution ownership
              -> M14 Close out
```

## Step summary

| Step | Primary output | Merge/deploy rule |
| --- | --- | --- |
| M0 | immutable snapshots and baseline | no production change |
| M1 | two frozen v1 contracts and ownership ADR | contract PR first |
| M2 | runtime repo + additive schema | no scraper code |
| M3 | client/stub/conformance harness | fixture cannot run in production |
| M4 | generic Hermes Tool Runs/plugin | fresh maintained Hermes base |
| M5 | real non-scrape processing | no fake receipts |
| M6 | complete action/read surface | capability-driven |
| M7 | Frank authenticated backend/triggers | Frank never calls scraper directly |
| M8 | complete UI/UX | Impeccable + accessibility gate |
| M9 | stub-backed E2E | cannot count as production proof |
| M10 | real scraper acceptance | contract pass required |
| M11 | restored-data rehearsal | no production volumes |
| M12 | production cutover | backend before schedules; Frank-driven canary |
| M13 | Blockwise cleanup | only after canary |
| M14 | evidence/retention closeout | rollback retained 35 days |

---

## M0 — Preserve the prototypes and establish the baseline

### Context

The previous Linux agent performed only a read-only audit. Valuable uncommitted prototypes remain on Windows. Preserve them before changing architecture.

### Tasks

1. Read each repository’s `AGENTS.md`/runbook and the integrated preservation/cutover protocol below. This plan and its scraper companion are the only Ad Radar implementation plans; no superseded plan is required.
2. Fetch without reset/rebase/clean and record branch/status/full SHA for Frank, Hermes and Blockwise.
3. Review staged/unstaged diffs, run the pinned secret scan defined below, commit explicit prototype files, and push unique `snapshots/ad-radar-<repo>-<UTC>-<SHA12>` refs without force or upstream tracking.
4. Verify remote snapshot SHAs equal local SHAs.
5. Inventory deployed repository/image SHAs, service IDs, Compose labels, volumes, ports, schedules, queue states and Meta API version without printing environments.
6. Create verified consistency backups and an isolated restore receipt using the guarded scripts/runbook specified below. Do not invent production `tar`/restore commands.

### Integrated preservation and cutover-safety protocol

- Use PowerShell 7.3+ with stop-on-error native command handling. Fetch and inspect Frank, Hermes and Blockwise without reset, rebase or clean. Run `git diff --check`, stage explicit paths only, inspect the staged name list/diff and forbid secrets, `.env*`, databases, dependency/build output, browser profiles and agent state.
- Scan staged content and full history using only `ghcr.io/gitleaks/gitleaks:v8.29.1@sha256:aa036a2f4bdfe3cc3c55fa4326308efabb4a6be498c883c864fd1d0d5585438a`, offline after pull, requiring reported version `8.29.1`; a scanner failure or finding blocks push.
- Snapshot dirty Frank and Hermes prototypes to new immutable remote refs named `snapshots/ad-radar-<repo>-<UTC>-<SHA12>`. Prove each ref was absent before push, never set upstream/force, and record/compare full local and remote SHAs. Delete only a proven generated `.test-python-wrapper`; never delete user work.
- On the VPS, record redacted repository SHAs, actual Compose service IDs, safe OCI/Compose labels, image IDs/digests, mounts, networks, ports, restart/user/health, schedule/queue counts and the central-Hermes-to-runtime route. Never print container environments, secret files, arbitrary labels or credential-bearing remote URLs.
- Produce exact `PRODUCTION_TOPOLOGY.md`, `OWNERSHIP_MATRIX.md` and `DATA_MIGRATION.md` evidence before implementation. Every service/path/volume/queue/schedule has one `MOVE | KEEP | RETIRE` disposition; every legacy queue row has a terminal/drain mapping; migrations are additive, versioned, transactional, advisory-locked, dry-run and old-runtime-compatible.
- The consistency set has six independently verified domains: research DB, Storage metadata DB, media bytes, raw-evidence bytes, old research-Hermes state, and central Hermes profile/Tool Run state. It also retains every running rollback image with immutable image ID and SHA-256. Capture numeric ownership/modes, counts, byte totals and NUL-safe sorted hashes; restore databases/files/state into uniquely named isolated resources and reconcile versions, constraints, sequences, stable IDs, counts and hashes.
- Before any production backup, merge reviewed ShellCheck/Bats-tested `scripts/vps/ad-radar-cutover-{backup,freeze,restore-rehearsal,compare}.sh` plus `docs/runbooks/AD_RADAR_BACKUP_RESTORE.md`. They consume one literal versioned manifest and enforce root/absolute-path/no-symlink guards, destination confinement under `/opt/blockwise-backups/research/cutover/`, free space of at least 1.25× source bytes plus 10 GiB, custom-format PostgreSQL dumps, numeric-owner filesystem archives, `.incomplete` plus atomic rename, checksums, fsync and receipt-scoped cleanup.
- The freeze tool writes/fsyncs an append-only journal before every mutation, pauses new schedules/runs, drains all active work, stops the old writer and automatically reverses completed mutations on error. It provides idempotent `recover` and `verify-thawed`; a consistency bundle requires its verified receipt. Restore rehearsal creates only receipt-named `ad-radar-restore-<UTC>-*` resources and can recover/destroy only targets re-resolved from that receipt—never globs, empty variables, production names or broad directories.
- Repeat the complete consistency set after the production freeze and do not thaw during cutover. Normal rollback selects retained images and a fresh fencing lease; restore data only for proven corruption after preserving the corrupt state.
- Retain snapshot refs/bundles, backups, journals and rollback images for 35 days. Delete them afterward only through a verified cleanup change with provenance/checksums retained. Final cleanup removes only proven temporary fixtures/wrappers/scratch resources, never user files or persistent production volumes, and never uses `git clean`.

### Verification

- Prototype worktrees are clean except documented user-owned files.
- Remote snapshot refs exist at exact SHAs.
- Database, Storage metadata, media, raw evidence, old research-Hermes state, central Hermes state and rollback images are backed up and checksummed.
- No implementation or production service has changed.

### Exit criteria

Record snapshot SHAs, baseline evidence root and backup receipt in this plan’s ledger.

---

## M1 — Freeze ownership and both service contracts before implementation

### Context

The two workstreams can move independently only after one exact contract exists. The main build owns the consumer contract because it owns canonical data and product semantics.

### Tasks

1. Require and review companion S-1's signed feasibility receipt/sanitized shape fixtures before freezing any provider-specific request-recipe, zero-result or media behavior. Create or adopt the private `stevenshelley58-afk/ad-radar-runtime` repository before writing the contract. If absent, bootstrap it with only `README.md`, `AGENTS.md`, `docs/` and `contracts/` on `main`, then do contract work on `codex/scraper-contract-v1`. If it exists, verify it is the expected private repository, read its instructions and create the feature branch from its remote default branch. Do not import donor runtime history in this step.
2. Add `docs/adr/ADR-001-external-scraper-boundary.md` with the ownership table from this plan.
3. Add the canonical scraper contract package:

   ```text
   contracts/scraper/v1/openapi.yaml
   contracts/scraper/v1/schemas/*.json
   contracts/scraper/v1/examples/*.json
   contracts/scraper/v1/fixtures/*
   contracts/scraper/v1/compatibility.json
   contracts/scraper/v1/CHANGELOG.md
   ```

4. Implement the exact companion-plan endpoints and rules. The frozen schemas include request recipe/`StructuralShapeV1`, scope, coverage, unified states/events/errors, multidimensional budgets/deadlines, acquisition/dataset/signature receipts, trusted verification-key metadata, `IdempotencyMaterialV1`, artifacts, warnings and retention. Publish deterministic checksum/signature fixtures.
5. Add a second canonical contract package for Hermes-to-runtime execution:

   ```text
   contracts/executor/v1/openapi.yaml
   contracts/executor/v1/schemas/{command,operation,event,checkpoint,error}.json
   contracts/executor/v1/examples/*
   contracts/executor/v1/compatibility.json
   ```

6. Freeze this executor protocol:
   - Hermes calls a separately deployed private runtime service over mTLS; the plugin is a client/adapter, not an embedded second control loop.
   - `POST /v1/executions` accepts one already-authorized stage/action with `project_id`, `tool_run_id`, `stage`, `stage_attempt_id`, immutable settings revision/digest, expected checkpoint/version, principal/approval receipt reference where required, idempotency key and request hash.
   - `GET /v1/executions/{operation_id}`, `GET .../events?after=`, and `POST .../cancel` provide reconciliation, durable stage-local events and cooperative cancellation.
   - Hermes durably records command acceptance/idempotency before dispatch. Runtime journals unique `(project_id, idempotency_key)` and compares the stored request hash before executing.
   - Transport retries reuse identical bytes/key. A reconciled logical stage retry uses a new `stage_attempt_id`/key linked to the same Tool Run/stage. Runtime never creates a run, stage, schedule or approval.
   - Runtime emits immutable `(operation_id, runtime_sequence)` events. Hermes deduplicates them and assigns the public Tool Run event sequence.
   - Runtime heartbeats contain operation/version/checkpoint/lease expiry. A lease permits only the bounded accepted operation, not progression to another stage. On expiry/restart, Hermes queries operation state before redispatch.
   - A completed result includes expected/new checkpoint versions, result checksum, safe summary and receipt references. Hermes alone decides/records the next stage.
   - Cancel is recorded by Hermes first, propagated with expected runtime version, and remains `cancel_requested` until runtime proves workers/writes stopped.
7. Publish request/result/error/event fixtures for happy, recipe discovery, schema drift, clean zero, effective-bound completion, `succeeded_partial`, optional-media loss, pre/post-accept rate limiting, sealing, cancelled, discarded, failed, duplicate and mismatched-idempotency cases. Publish RFC 8785/JCS checksum test vectors in at least two language implementations.
8. Define compatibility: additive optional fields may increment minor; removing/changing a field, status or semantic rule requires `/v2`.
9. Add generated-schema validation and consumer/provider conformance tests in both directions.
10. Publish checksum/versioned contract artifacts for Hermes/runtime and Steven’s scraper build; neither consumer copies/edits schemas.
11. Obtain a joint contract review. Any unresolved ambiguity about field meaning, authority, heartbeat/lease, artifact lifetime, limits or status mapping blocks implementation.

### Exit criteria

- Scraper and Executor/Runtime contracts `1.0.0` are committed, pushed, checksummed and independently reviewed.
- Every field has type, bounds, ownership and redaction classification.
- S-1 feasibility evidence is represented by contract fixtures without session tokens, provider secrets, raw payloads or retained real media.
- Steven can begin companion plan S0 using only the published artifact.

---

## M2 — Extract the runtime and own the canonical database

### Context

Extract the legacy research orchestration/persistence from Blockwise but deliberately exclude provider-specific scraping implementation. Preserve existing tables/IDs and migrate additively.

### Tasks

1. Import filtered donor history into the existing runtime repository through a new branch/PR. Use a disposable `git clone --no-local`, pin the exact reviewed Blockwise SHA, run `git filter-repo` only in that disposable clone, scan the complete filtered history, fetch it as a temporary local remote, merge with `--allow-unrelated-histories` inside a guaranteed abort/remove-remote cleanup block, and never force/replace the merged M1 history.
2. The filter allowlist is exactly:
   - `hermes/tools/research-runtime/**` for persistence/processing code to refactor;
   - `infra/coolify/docker-compose.research.yml`;
   - `infra/research-db/**` and `infra/research-storage/**`;
   - `scripts/vps/research-*.sh`, reviewed cutover backup scripts and research restore scripts;
   - `docs/runbooks/oss-hermes-storage.md` and the reviewed backup/restore runbook.

   Explicitly exclude `hermes/tools/meta-library-capture/**`, browser profiles, provider payloads and media. Do not execute or copy old extraction-plan Step 2 Tasks 3 or 6; they include obsolete scraper ownership/layout.
3. Retain database migrations, persistence, normalization, classification, QA, audit and publisher code.
4. Sanitized fixtures needed for compatibility must be newly authored in M1 and contain no executable provider logic or real payload.
5. Split the legacy supervisor into focused modules and remove self-scheduling. Hermes owns schedules.
6. Create `docs/DATA_MODEL.md` and an additive migration plan for these logical entities, mapping to existing tables where present rather than duplicating them:
   - projects and immutable non-authoritative projections of Hermes settings revisions/digests;
   - source definitions and non-secret scraper connection profiles;
   - Hermes run/stage/checkpoint correlations;
   - acquisition requests, attempts, events and idempotency journal;
   - persisted import transitions `descriptor_recorded`, `bytes_staged`, `verified`, `objects_promoted`, `canonical_committed`, `acknowledged`, plus failure/recovery/orphan receipts;
   - temporary-dataset manifests, import receipts and artifact acknowledgements;
   - source documents, advertisers and resolution decisions;
   - observed ads, snapshots, creatives and immutable creative versions;
   - lifecycle facts `first_seen`, `first_seen_active`, `last_seen`, `last_seen_active`, `missing_since`, `inactive_at`, `inactive_evidence`, `reactivated_at`, plus `historical_record_scope_fingerprint`, stable-window completeness and resolution comparison receipts;
   - canonical media assets and object checksums;
   - classification decisions, media-QA receipts and accuracy-audit receipts;
   - quarantine items/resolutions;
   - candidate checksums, immutable projections/receipts of Hermes approvals, immutable releases and supersession links;
   - authoritative runtime-stamped acquisition origin/adapter/environment lineage with a release-level database prohibition on fixture lineage;
   - database-backed writer fencing leases.
7. Add project scope, foreign keys, uniqueness, stable-ID/content-hash rules and append-only release enforcement at DB level.
8. Scraper connection rows store only backend type, safe base-origin fingerprint, profile alias, contract version, capability digest, timestamps and health. Credentials remain in the secret store.
9. Add versioned, transactional, advisory-locked, dry-runnable migrations with old-runtime compatibility.

### Authority and projection rules

- Hermes is authoritative for settings activation, schedule-to-settings binding, operator principal/role and approval/rejection decisions.
- Runtime DB projections are immutable evidence keyed by Hermes record ID, project, revision/digest, principal, candidate checksum and Hermes event sequence. They cannot activate settings or grant approval.
- Settings activation commits in Hermes first; a durable executor command projects it into runtime. Runtime rejects stage work until the exact projection revision/digest exists, and Hermes retries/reconciles projection by idempotency key.
- Publish handshake: runtime persists a candidate/checksum/readiness receipt → Hermes records explicit checksum/revision-bound approval → Hermes dispatches `authorize_publish` with approval ID/principal/role/project/checksum/settings revision/digest → runtime validates the immutable local projections and unchanged candidate, writes the append-only release/receipt → Hermes records the returned release ID/hash. Any mismatch blocks publish.
- Reconciliation compares every Hermes authoritative record to its runtime projection and repairs only by replaying the original immutable command; it never edits either side in place.

### Required tests

- Existing production dump restores and migrates without changing stable IDs.
- Cross-project reads/writes fail.
- Duplicate acquisitions/imports do not duplicate ads, versions or media.
- Incomplete/non-comparable runs cannot mark ads inactive; creative content changes append revisions rather than overwriting history.
- Release/update/delete attempts by application roles fail.
- Missing scraper data can block a run without corrupting canonical state.

### Exit criteria

Runtime repo owns canonical persistence and migrations; no scraper can write the DB.

---

## M3 — Implement the scraper port, real HTTP client, and safe stub

### Context

This is the only seam between the product and Steven’s engine. Build it before any UI assumes acquisition behavior.

### Tasks

1. Define a domain interface independent of HTTP/provider details:

   ```text
   ScraperPort.health()
   ScraperPort.capabilities()
   ScraperPort.startResolution(command)
   ScraperPort.startCapture(command)
   ScraperPort.getRun(runId)
   ScraperPort.listEvents(runId, afterSequence)
   ScraperPort.listCandidates(runId, cursor, limit)
   ScraperPort.listItems(runId, cursor, limit)
   ScraperPort.getArtifact(runId, artifactId)
   ScraperPort.cancel(runId, expectedVersion)
   ScraperPort.acknowledgeImport(runId, receipt)
   ```

2. Implement `ExternalScraperClient` from the frozen OpenAPI contract with:
   - private HTTPS origin allowlist;
   - secret alias resolution outside logs;
   - contract/capability negotiation;
   - bounded timeouts, polling, pages, items and bytes;
   - an explicit identifier chain: `tool_run_id` → stable `logical_acquisition_id` → new `stage_attempt_id` per reconciled retry → scraper-returned `scraper_run_id`;
   - mutation journals unique on `(project_id, idempotency_key)` with the stored canonical `IdempotencyMaterialV1` request hash; same key/different hash is a conflict;
   - exact-byte/key transport replay, new attempt/key for a stage retry, and a new logical acquisition for operator recapture;
   - replay lookup before optimistic-version comparison for cancel/ack so a completed mutation replay remains successful after its version advances;
   - operation reconciliation before retry;
   - typed errors and redacted logs;
   - strict state/event mapping for `queued`, `running`, `sealing`, `succeeded`, `succeeded_partial`, `failed`, `cancelled` and `discarded`;
   - request-recipe/schema-fingerprint, coverage, scope-hash, endpoint-affinity receipt, multidimensional budget/deadline and deterministic-checksum validation before import;
   - pinned capability verification-key validation and Ed25519 dataset-signature verification before import;
   - stable relative artifact-path/base-origin validation, streaming checksum/size/`detected_media_type` validation and canonical import.
3. Implement `UnavailableScraper` as the default when no real profile is configured. It returns an explicit unavailable dependency result and cannot create a passed acquisition receipt.
4. Implement `FixtureScraper` only for automated tests/local demo. Runtime—not the fixture payload—stamps immutable authoritative lineage from its selected adapter/profile/environment (`acquisition_origin=fixture`, adapter revision and environment). Any payload `synthetic` flag is informational and untrusted.
5. Add startup and database guards: production refuses `FixtureScraper`; a DB constraint/trigger prevents fixture-lineage candidates from entering a release, and the publisher independently rejects them.
6. Build a standalone deterministic contract-test server and consumer conformance runner from v1 examples.
7. Add a connection-health cache with short TTL, but never treat cached health as evidence that a later capture succeeded.

### Exit criteria

- Main product builds without the real engine.
- Production stays truthful and blocked when the engine is absent.
- Client/stub/conformance behavior passes all v1 examples.
- The identifier/retry matrix and fixture-lineage database gate pass restart and adversarial-payload tests.

---

## M4 — Build Hermes as the sole run, schedule and approval owner

### Context

Use fresh current `origin/main` (or maintainer-declared maintained remote release branch). The divergent prototype is donor-only.

### Tasks

1. Manually port only generic Tool Run storage/API behavior with donor-SHA/file trailers.
2. Add a generic executor registry/plugin contract and install the Ad Radar plugin from the runtime repo.
3. Hermes durably owns run creation, immutable settings revisions, schedule ticks, stage transitions, valid actions, pause/resume/cancel/retry, ordered events and approval records.
4. Runtime receives a sanitized immutable settings snapshot/revision/digest with each dispatch and rejects mismatch.
5. Hermes records accepted mutation/idempotency tuple before runtime dispatch and reconciles operation state after timeouts.
6. Authorize `(authenticated principal, project, action)` before reading or mutating.
7. Expose safe project-scoped reads/actions used by Frank; filter project before pagination.
8. If plugin/runtime/scraper capability is unavailable, Hermes rejects a new run or blocks its acquisition stage truthfully.

### Exit criteria

- Hermes core contains generic infrastructure only.
- All targeted/full wrapper tests pass through `scripts/run_tests.sh`.
- Ad Template Generator regressions pass.

---

## M5 — Build every real pipeline stage around acquisition

### Required stages

1. `discover`: turn project settings/source roster into stable candidates; do not pretend candidates are ads.
2. `resolve`: ask `ScraperPort` for provider page/source resolution and persist confidence/evidence; quarantine ambiguity.
3. `capture`: create one bounded scraper run, consume truthful events, require sealed dataset, import items/artifacts, acknowledge only after canonical commit.
4. `normalize`: compute stable creative identity/hash, safe fields, first/last seen and version lineage.
5. `classify`: model-backed real classification with version/confidence/rationale; deterministic fallback cannot satisfy release confidence.
6. `media_qa`: validate actual canonical bytes, MIME, size, dimensions, decode, hash, duplicates, object existence and passive-preview safety.
7. `publish`: accuracy audit, mandatory PII/secret/unsafe-content scans, candidate checksum, Hermes approval and immutable release.

### Acquisition truth rules

- Scraper `failed`, `cancelled`, `discarded`, `succeeded_partial`, or any `coverage.complete=false` result cannot become passed capture. Warnings/stop reasons are metadata, never run states.
- Zero results are valid only for `succeeded` with recipe-validated expected result container present/empty, `stop_reason=zero_results_confirmed`, exhausted pagination, matching scope hashes and a sealed zero-count receipt.
- Clean `max_items`/`max_pages` completion may be `succeeded` for the accepted effective scope, but a dynamic ordered prefix can never support absence-based inactivity. Deadline, budget, throttle, access, verification, session, crash or schema interruption is partial/failed and never clean zero.
- Pre-accept HTTP 429 creates no scraper run and is reconciled by the same mutation key. A post-accept throttle with no consumable dataset ends `failed/provider_rate_limited`; a valid partial dataset ends `succeeded_partial/provider_rate_limited_partial` and is permanently ineligible for that release attempt.
- Structured warning policy has three release effects: `informational` is recorded and may pass; `review_resolvable` requires the runtime to quarantine/exclude the affected items and recompute the candidate; `permanently_ineligible` blocks the run from release and requires a clean recapture. A human cannot override permanently ineligible acquisition evidence.
- Runtime validates every scraper item and artifact; the scraper is not trusted canonical input.
- Canonical import is an idempotent persisted state machine, not a cross-service transaction: descriptor recorded → bytes staged → size/hash/MIME verified → content-addressed objects promoted → canonical DB rows plus import receipt committed → exact manifest/receipt acknowledged. Restart recovery resumes at any boundary; orphan staged/promoted objects are reconciled and garbage-collected only after the retention window. Acknowledgement binds run, dataset checksum, artifact manifest checksum, counts and canonical import receipt ID.

### Historical lifecycle boundary

- Persist `first_seen`, `first_seen_active`, `last_seen`, `last_seen_active`, `missing_since`, `inactive_at`, `inactive_evidence` and `reactivated_at` as explicit facts; never infer them inside the scraper.
- Define a separate `historical_record_scope_fingerprint` over provider, canonical target-resolution ID/revision, market/country, active-status/date/query filters, stable partition/window identity and completeness-model revision. Exclude queue/execution/deadline, cost/request/byte/media limits, concurrency, endpoint class and presentation fields.
- Mark absence/missing/inactive only when: the current dataset is `succeeded`; provider record coverage is exhausted, or every contract-declared stable partition/window has an explicit completeness guarantee and is exhausted; its historical record-scope fingerprint matches the comparison series; canonical target resolution is unchanged; the ad was expected within that exact stable scope/window; and absence repeats across the configured number of comparable complete runs.
- A dynamic first-N/page prefix—even with `coverage.complete=true` for its effective bound—cannot advance absence. Neither can a partial, failed, cancelled, discarded, non-comparable, or changed-resolution run. Reactivation records a new fact and preserves prior inactive evidence.
- Creative copy/media changes create immutable content-hash revisions. They never overwrite prior creative records.
- Ad lifecycle and evidence/media retention are independent. Status changes never auto-archive or delete canonical evidence/media.

### Exit criteria

All real non-scrape processing works against fixture contract data, with complete negative-path tests and no fabricated receipt.

---

## M6 — Complete operational reads, commands and schedules

Implement and behavior-test:

- run, retry, pause, resume, cancel and retry-stage;
- validate/activate settings revision;
- test scraper connection;
- create/update/pause/resume/delete schedule;
- recapture, reclassify and recheck media;
- archive/restore/quarantine/resolve quarantine;
- approve/reject creative;
- approve publish, verify release and supersede release;
- health, source coverage, run/event reads, library/detail/compare reads and release reads.

Every mutation requires project scope, expected version/checksum where relevant, reason for rejection/destructive actions, one ordered event and one audit receipt. Capability responses expose only implemented actions valid in the current state.

### Exit criteria

Manual and scheduled runs use the same pipeline; one Hermes scheduler and one database-fenced runtime writer exist.

---

## M7 — Build the Frank backend and trigger boundary

### Tasks

1. Rebuild the Frank branch from fresh `origin/main` and deliberately reapply the preserved prototype.
2. Keep `ad_radar.py` as a strict allowlisted projection/proxy to Hermes.
3. Add routes for contract, dashboard, runs/events, creatives/compare, attention, schedules, settings, connection test/health and releases/actions.
4. Authenticate the operator and derive allowed projects server-side. Reject browser-supplied actor/role/unauthorized project.
5. Require CSRF, same-origin/Host validation, bounded bodies, timeouts and per-principal/project rate limits.
6. Frank calls Hermes over service mTLS and creates a short-lived signed principal assertion (JWS/JWT) containing `sub`, roles, allowed project, audience, issued/expiry times (maximum 60 seconds), nonce, HTTP method/path and body digest. Hermes verifies signature, audience, time, nonce replay and its own current entitlement data; browser-supplied identity is discarded. Hermes calls runtime over the separately frozen mTLS executor contract.
7. Frank never forwards arbitrary auth headers and never exposes the runtime/scraper origin, client certificate, bearer credential or artifact URL. Rotate signing/service keys with overlap and audit only key IDs.
8. SSE reconnects from the last durable Hermes event sequence and deduplicates.
9. Add safe error/state mapping for `scraper_not_configured`, incompatible, unavailable, pre-accept rate limit, `sealing`, `succeeded_partial`, schema changed, access/verification/session blocked, budget/deadline stopped, `discarded`, failed and cancelled.

### Exit criteria

All trigger paths pass backend behavior/security tests with no direct scraper import/call.

---

## M8 — Build and finish the complete Frank UI/UX

### Required surfaces

- Overview: health, connection, coverage, last/next run, attention and release status.
- New run: current settings revision, source selection, requested hard bounds, effective server-clamped bounds with reasons, enforced provider/model cost caps and cost estimate.
- Run detail: declared stages versus observed progress, live ordered events, authoritative run state, request-recipe/schema fingerprint, coverage/stop reason, requested/effective scope, endpoint region/class, media counts, cost reservations/settlement and cancel/pause/retry.
- Creative library: search, filters, pagination, saved scope, compare selection.
- Creative inspector: safe copy/media/provenance, versions, classification, measured QA, decisions and valid actions.
- Attention queue: low-confidence, degraded acquisition, media defects, scan hits and quarantine resolution.
- Schedules: create/edit/pause/resume with next/last run and settings revision.
- Settings/connections: immutable revision diff, validate/activate, scraper profile alias, contract/capability status and connection test.
- Publish/release: readiness checklist, candidate checksum, explicit approval, immutable release inspection/verification/supersession.

### UX rules

- Never show a fake percentage; distinguish declared plan, completed work and unknown provider progress.
- Engine absent is a useful setup state, not a generic error.
- Display warning code/scope/release effect, provider degradation and requested-versus-effective bounds/cost before approval.
- Never label a result complete or zero from item count alone; show the coverage verdict and stop reason. Partial/discarded/schema-changed states need explicit recovery actions.
- Raw evidence/artifact URLs remain private; show safe receipt/provenance summaries.
- Preserve keyboard operation, focus restoration, visible focus, landmarks, live announcements, non-color meaning, reduced motion and mobile layouts.

### Quality gate

Use the Impeccable workflow `audit -> critique -> harden -> optimize -> polish`, real desktop/mobile browser journeys and accessibility tests. Update `PRODUCT.md`, `DESIGN.md` and its sidecar from the shipped artifact.

### Exit criteria

Every UI action is driven by live capabilities/current state and works against the fixture stack without implying production acquisition is installed.

---

## M9 — Prove the complete product against the strict stub

Run an integration stack with restored disposable DB/media copies, Hermes, runtime, contract-test server and Frank. Exercise:

- connection ready/unavailable/incompatible;
- manual and scheduled run;
- non-empty success, legitimate zero, effective-bound success, optional-media warning, `succeeded_partial`, provider rate limit, schema drift, failed, discarded, sealing and cancellation;
- pause/retry/restart/checkpoint recovery;
- idempotency reuse/mismatch and timeout reconciliation;
- scope/coverage hash mismatch, endpoint-attempt mixing, stale fencing token, JCS checksum vector and interrupted-seal recovery;
- artifact checksum/MIME/size/origin failures;
- normalization/classification/media QA/quarantine;
- approval checksum race, scanner failure, immutable release and supersession;
- cross-project/auth/CSRF/PII-secret negative tests;
- desktop/mobile/keyboard journeys.

Synthetic fixture lineage must block a production release even when all other gates pass.

### Exit criteria

The product is otherwise complete. The only remaining external dependency is a v1-conformant real scraper endpoint/profile.

---

## M10 — Accept and connect Steven’s real scraper engine

### Inputs required from the scraper build

- private reachable base origin;
- secret-store credential/key ID, never pasted into Git or the ledger;
- contract version and artifact checksum;
- capability response and supported provider/profile IDs;
- immutable image/revision evidence;
- completed provider, security, limit, cancellation and conformance receipts.
- S-1 recipe/schema-drift/zero/media feasibility receipt and S8 immutable candidate handoff packet.

### Tasks

1. Prove runtime-to-scraper DNS/TLS/auth reachability; Frank/browser must not reach it. Negotiate through `/versions`, then pin `expected_capability_digest` and `expected_profile_revision` on every create.
2. Add negative reachability evidence: an external client, Frank container/service identity and browser path cannot resolve/connect/authenticate to scraper control/artifact routes; Frank source/image/config contains no scraper origin, client credential or artifact-signing material; gateway policy accepts only the exact runtime mTLS identity.
3. Run the published conformance harness unchanged against the real endpoint.
4. Verify capability/version/profile, requested/effective clamp reporting, queue/execution/deadline bounds, atomic hard provider-cost enforcement and configured limits; require every terminal run/acquisition receipt to report the exact accepted engine/capability/profile/adapter revisions.
5. Test recipe discovery/fingerprint validation, one source resolution, bounded capture, clean zero, effective-bound and partial coverage, pagination, endpoint-attempt isolation, event order, atomic sealing, artifact import/checksum, acknowledgement and cancellation.
6. Force/reconcile a response timeout after scraper commit and prove no duplicate run.
7. Store only connection alias/health metadata in canonical DB.
8. Flip the runtime profile from `unavailable` to `external` in non-production and rerun M9 without fixture mode.

The main agent owns and signs the joint acceptance receipt. The scraper agent owns its provider/conformance/security/load evidence referenced by that receipt.

### Exit criteria

Real engine passes every mandatory v1 test. A waiver is not a pass; fix the contract implementation or version it.

---

## M11 — Rehearse production data and migration

1. Restore verified production DB, Storage metadata, media, raw evidence and Hermes state into isolated resources.
2. Apply migrations with dry-run/version/advisory lock.
3. Reconcile every old queue state and stable ID/object reference.
4. Prove old/new database fencing.
5. Start the old Compose identity, manage it from the runtime repo, and prove no duplicate data-plane service/volume.
6. Run the real scraper with canary bounds against the isolated stack.
7. Complete the authenticated Frank journey through approval/release.
8. Rehearse application rollback without data restore and corruption restore separately.

The main agent owns the rehearsal/migration receipt. The scraper agent supplies only the immutable engine run evidence referenced by it.

### Exit criteria

Migration, real acquisition, reconciliation, restart, rollback and complete Frank browser proof pass.

---

## M12 — Merge, promote and perform the production cutover

Merge runtime, Hermes and Frank PRs only after merge-SHA CI; build/publish immutable images, the plugin and Frank's complete image manifest; retain rollback images. Companion S11 is an interlocked gate inside M12: its signed scraper production promotion/rollback receipt is required after M12a and before writer activation in M12b. The integrated preservation and cutover-safety protocol in M0 and the required order below are authoritative for journaled freeze, six-domain consistency backup and rollback.

Required order:

1. Preflight backup, journaled freeze of old schedules/jobs/writer, verified six-domain backup; do not thaw.
2. Apply rehearsed additive migrations.
3. Deploy runtime writer-disabled and provision its production mTLS identity, private egress route and accepted scraper connection settings. If a gateway already exists, verify a non-scrape TLS handshake; for a first install, record the endpoint as absent until S11. This completes M12a.
4. Scraper owner executes companion S11: stop acceptance; drain/reconcile active runs; back up/restore-test its PostgreSQL and unacknowledged artifact state; apply the S10-rehearsed locked migration; rebuild Redis from the durable outbox; promote the exact S9/S10-accepted digest/config; verify it using the production runtime identity; and prove previous-image/schema or database+artifact restore rollback while all main writers/schedules remain paused.
5. Deploy Hermes/plugin; schedules remain paused.
6. Acquire the new fencing token and enable one writer.
7. Deploy Frank using its immutable image-manifest release mode; schedules remain paused.
8. Through authenticated Frank, run a canary limited to one approved page, one market, ten creatives, two media each, 100 MiB, two queue minutes, 15 execution minutes, an absolute 20-minute deadline, one browser worker, one classifier worker and a hard USD 2 total cap. Allocate separate explicit provider and model sub-caps whose sum is at most USD 2; refuse the run if either backend cannot enforce its cap or return a complete reservation/settlement receipt.
9. Reconcile, approve through Frank, verify immutable release.
10. Enable scheduling and observe one actual bounded tick. If the normal cadence exceeds 60 minutes, create a temporary 15-minute canary schedule, observe exactly one deduplicated tick, then pause and remove it before enabling the normal schedule.
11. Roll back through the retained freeze journal, prior main images and prior scraper digest/config on any data loss/duplication, revision drift, fencing failure, private leak, false receipt, failed scan, stale approval or Frank regression.

### Exit criteria

Frank → Hermes → runtime → real scraper → canonical DB → approval/release works in production, with evidence and rollback retained.

---

## M13 — Remove Blockwise execution ownership

Only after M12 succeeds, create a fresh Blockwise cleanup worktree/PR from current `origin/main`. Use the explicit ownership matrix; delete only exact `MOVE`/`RETIRE` paths whose replacement is verified. Keep applied migrations and any enabled customer approved-release read model. Remove old research writer/schedules/provider capture/operator UI without touching persistent volumes. Require CodeGraph dependency proof, full tests/build, independent review, merge-SHA CI and exact deployment.

### Exit criteria

Blockwise is at most an optional public-release consumer and owns no Ad Radar execution.

---

## M14 — Close out

1. Confirm production exact SHAs/digests and scraper revision/contract.
2. Store redacted evidence for tests, migration, reconciliation, security, UI and canary.
3. Retain snapshots, verified main/scraper PostgreSQL and unacknowledged-artifact backups, freeze journal, main rollback images and previous scraper image/schema/config receipt for 35 days.
4. Remove temporary real-data fixtures and test resources safely; never `git clean` user worktrees.
5. Produce a final ownership/runbook diagram and one-command health/rollback references.

## Anti-patterns

- Implementing any provider scraper, browser automation, proxy/session, CAPTCHA or selector logic in the main build.
- Letting Frank/browser call the scraper directly.
- Giving the scraper canonical DB or release-storage credentials.
- Letting the scraper create schedules, canonical creative IDs, classifications, QA passes, approvals or releases.
- Treating fixture/synthetic data as production-releasable.
- Treating `succeeded_partial`, `discarded`, incomplete coverage, schema drift or item count alone as clean capture/zero.
- Retrying a timed-out scraper mutation before operation reconciliation.
- Accepting arbitrary artifact URLs or trusting scraper MIME/hash/size without verification.
- Hiding unavailable/incompatible scraper state behind zero results.
- Deleting Blockwise execution before the real-engine production canary.

## Plan mutation protocol

If evidence makes a step wrong, add a dated entry below with the evidence, affected boundary, replacement and dependent steps. Contract changes after `1.0.0` require compatibility analysis; breaking semantics require `/v2`, never a silent edit. Do not mark a blocked step complete. Continue independent safe work.

## Progress ledger

| Step | Status | Commit/receipt | Notes |
| --- | --- | --- | --- |
| M0 Preserve/baseline | not started | | |
| M1 Scraper + executor contracts/ownership | not started | | |
| M2 Runtime/database | not started | | |
| M3 Scraper port/stub | not started | | |
| M4 Hermes control plane | not started | | |
| M5 Pipeline | not started | | |
| M6 Actions/reads | not started | | |
| M7 Frank backend/triggers | not started | | |
| M8 Frank UI/UX | not started | | |
| M9 Stub integration | not started | | |
| M10 Real scraper acceptance | blocked on companion S8 | | |
| M11 Production-data rehearsal | not started | | |
| M12 Production cutover (includes interlocked scraper S11) | not started | | |
| M13 Blockwise cleanup | not started | | |
| M14 Closeout | not started | | |

## Plan deviations

- 2026-09-03: incorporated Steven's pre-freeze structured request-recipe, coverage, private scraper-ledger, fencing, endpoint-affinity, media, unified-state, lifecycle and atomic-budget amendment. Canonical database/lifecycle remains in the main runtime; scraper PostgreSQL/Redis remains isolated operational state. Dependencies and contract review were reopened and the amended plans were approved with no P0/P1 blockers.
