# Ad Radar scraper engine interface and implementation plan

Status: approved implementation handoff
Contract owner: Ad Radar runtime repository
Engine owner: Steven / scraper implementation agent
Contract target: `ad-radar-scraper-api` v1.0.0
Companion product plan: `docs/plans/AD-RADAR-FRANK-EXTERNAL-SCRAPER.md`
Review: approved after request-recipe/coverage/durability amendment; no open P0/P1 blockers (2026-09-03)

## Instruction to the scraper implementation agent

Build only the acquisition engine and its private gateway. This may be a broad Apify-style platform internally—actors, browser pools, proxy/session management, queues, datasets, logs and artifact storage—but Ad Radar must see only the narrow versioned API in this document.

Do not modify Frank, Hermes, the canonical research database, classifications, QA rules, approvals or publishing. Do not copy the contract and change it locally. Consume the immutable contract artifact published by the main build. When the contract appears insufficient, open a contract-change proposal and keep current behavior conformant until a new compatible version is published.

## What this engine does

- Resolve a requested public advertiser/source identity to provider page identifiers with evidence and confidence.
- Run bounded provider acquisition jobs.
- Discover and validate a complete structured `request_recipe` before interpreting provider responses.
- Handle browser/API/provider versions, navigation, pagination, proxies, sessions, anti-bot behavior and provider throttling.
- Capture public ad records, source documents, raw provider evidence and source media.
- Produce an immutable sealed temporary dataset with explicit coverage, ordered events, truthful counters, warnings and checksummed artifacts.
- Retain the dataset long enough for the Ad Radar runtime to import and acknowledge it.

## What this engine never does

- It never authenticates the human operator.
- It never decides project access, run schedules or approval authority.
- It never receives canonical DB credentials or writes canonical research tables.
- It never creates canonical creative/version/media/release IDs.
- It never classifies ads, declares media QA passed, resolves quarantine, scans public exports or publishes releases.
- It never exposes an endpoint to the public browser or accepts arbitrary URLs from Frank.
- It never reports a provider/backend failure as a successful zero-result run.
- It never persists browser-session tokens, cookies or session-bound request secrets outside the live browser context.

## Integration position

```text
Frank UI/API
  -> Hermes durable run
    -> Ad Radar runtime
      -> ExternalScraperClient
        -> this private gateway
          -> actor/browser/proxy/session engine
          -> temporary dataset/artifacts
      <- validated items/artifacts/events
    -> canonical DB and downstream pipeline
```

Only the Ad Radar runtime service identity may call this gateway. The gateway may be deployed on another host, but it must be reachable through a private authenticated HTTPS route. Frank and the public internet must not be able to reach its control API.

## Contract source of truth

The main agent publishes:

```text
contracts/scraper/v1/openapi.yaml
contracts/scraper/v1/schemas/*.json
contracts/scraper/v1/examples/*.json
contracts/scraper/v1/compatibility.json
contracts/scraper/v1/CHANGELOG.md
```

The scraper build must pin the artifact version and SHA-256. Generated server types are allowed; hand-edited divergent schemas are not.

This amendment is incorporated before M1 freezes/publishes v1.0.0. No deployed or frozen v1 exists, so the required state and schema changes below do not consume a `/v2`. After M1 publishes v1.0.0, the existing compatibility rules apply.

## Structured request recipe and schema-drift fail-closed rule

Before extracting any result, the active provider adapter discovers and persists a secret-free `request_recipe`:

```json
{
  "recipe_version": "1.0",
  "provider": "meta_ad_library",
  "profile_revision": "profile-revision-id",
  "operation_signature": "provider-operation-signature",
  "encoding_type": "graphql_json",
  "variable_path": "/variables",
  "cursor_location": {
    "request_path": "/variables/after",
    "response_path": "/data/library/page_info/end_cursor"
  },
  "response_item_path": "/data/library/items",
  "response_pagination_path": "/data/library/page_info",
  "structural_shape_algorithm": "StructuralShapeV1",
  "root_shape": {
    "kind": "object",
    "properties": [
      {
        "name": "data",
        "required": true,
        "nullable": false,
        "shape": {
          "kind": "object",
          "properties": [
            {
              "name": "library",
              "required": true,
              "nullable": false,
              "shape": {
                "kind": "object",
                "properties": [
                  {"name":"items","required":true,"nullable":false,"shape":{"kind":"array","item_shape":{"kind":"object","properties":[{"name":"ad_id","required":true,"nullable":false,"shape":{"kind":"string"}}]}}},
                  {"name":"page_info","required":true,"nullable":false,"shape":{"kind":"object","properties":[{"name":"end_cursor","required":true,"nullable":true,"shape":{"kind":"string"}}]}}
                ]
              }
            }
          ]
        }
      }
    ]
  },
  "schema_fingerprint": "sha256:..."
}
```

- `encoding_type` is `graphql_json | json | form | query` in v1. All paths are RFC 6901 JSON Pointers, or an encoding-specific equivalent explicitly declared in the schema.
- `structural_shape_algorithm` and the complete `root_shape` are required recipe fields. The JSON above is illustrative provider data, but its recursively tagged union is the exact `StructuralShapeV1` wire encoding; there is no separate normalized-key representation.
- Freeze `StructuralShapeV1` exactly: JSON scalar kinds are `null | boolean | integer | number | string`; objects normalize to `{kind:"object", properties:[{name,required,nullable,shape}]}` sorted by UTF-8 key bytes; arrays normalize to `{kind:"array",item_shape}` using one recursively merged homogeneous item shape. Required/optional/nullability policies come from the reviewed adapter recipe, not one response. Array elements may reorder without changing shape; incompatible element kinds are drift. Empty arrays use the adapter-declared item shape—an adapter cannot become ready from empty-only evidence without a previously reviewed non-empty/declared shape. Unknown object keys, missing required keys, disallowed nulls and scalar/container type changes are drift; absent declared optional keys are not.
- `schema_fingerprint` is SHA-256 over RFC 8785/JCS of `{algorithm:"StructuralShapeV1",encoding_type,root_shape,response_item_path,response_pagination_path}`. Provider values, tokens, IDs and counts are excluded. Publish two-language vectors for object-key/item reordering, optional-key absence/presence, empty arrays, null/type/container changes, missing required keys, unknown keys and pagination-container drift.
- The recipe contains field names/paths only—never cookies, access tokens, request headers, cursor values or session identifiers. Session-bound values live only inside the active isolated browser context and are never placed in PostgreSQL, Redis, events, logs or datasets.
- Validate every provider response against the complete recipe before reading items, pagination or zero-result meaning. A missing/unrecognized container, unexpected encoding or changed structural fingerprint terminates that attempt as `source_schema_changed`; it is never interpreted as zero results.
- Schema drift terminally fails the accepted scraper run as `source_schema_changed` with no consumable dataset. Rediscovery occurs only after the main runtime/Hermes creates a new reconciled stage attempt and idempotency key and the changed recipe/profile/capability is reviewed; the scraper never auto-rediscovers inside the failed run.
- Normal events/run details expose only `request_recipe_id` and `schema_fingerprint`; the secret-free full recipe remains private engine evidence under the run retention policy.

## Requested/effective scope and coverage

Canonicalize requested and accepted effective scope with RFC 8785/JCS and store both SHA-256 hashes. Every sealed resolution/capture dataset contains this required `coverage` object:

```json
{
  "complete": false,
  "stop_reason": "deadline",
  "requested_scope_hash": "sha256:...",
  "effective_scope_hash": "sha256:...",
  "pages_started": 14,
  "pages_completed": 13,
  "items_observed": 486,
  "items_emitted": 481,
  "duplicates_removed": 5,
  "media_expected": 620,
  "media_acquired": 608,
  "pagination_exhausted": false,
  "pagination_outcome": "interrupted",
  "last_cursor_hash": "sha256:...",
  "attempt_count": 2,
  "warnings": ["media_missing", "pagination_incomplete"]
}
```

- `stop_reason` is exactly `source_exhausted | zero_results_confirmed | max_items | max_pages | deadline | budget_exhausted | rate_limited | access_restricted | verification_required | session_expired | browser_crashed | source_schema_changed | cancelled`.
- `pagination_outcome` remains `exhausted | effective_bound_reached | interrupted`. `source_exhausted`/`zero_results_confirmed` map to `exhausted`; clean `max_items`/`max_pages` map to `effective_bound_reached`; every other stop maps to `interrupted`.
- `complete=true` means the accepted effective record scope completed with `exhausted` or `effective_bound_reached`. Optional media loss does not make record coverage incomplete, but its counts/warnings remain explicit. Interrupted acquisition always has `complete=false`.
- `last_cursor_hash` is nullable when no cursor was observed and never contains the cursor. Coverage warning codes are unique and sorted; top-level warning objects carry scope/reason detail.
- Coverage `media_missing` is the aggregate code when any optional media is absent; each affected item has a top-level `artifact_missing` warning with the structured reason.
- Zero results require the recipe's expected result container to be positively present and empty, no continuation, `stop_reason=zero_results_confirmed`, `pagination_exhausted=true`, `pagination_outcome=exhausted`, `complete=true` and sealed zero counts. Missing containers, parsing failures and schema drift are not zero.

## Private operational ledger, queues and attempts

The scraper owns an isolated operational data plane, never the canonical Ad Radar database:

- PostgreSQL (or an equivalently transactional durable store) is authoritative for run identity, canonical request hash, state/version, request-recipe record, requested/effective scope, attempt records, terminal result, coverage/dataset/artifact checksums, cost reservations/settlements, acknowledgement and expiration/cleanup state.
- Redis is non-authoritative and limited to at-least-once worker delivery/visibility mirrors, network-region routing hints, rate-limit mirrors, short-lived progress counters and non-secret temporary coordination. It never issues or validates lease/fencing authority. Browser cookies/session tokens never enter Redis.
- Queue delivery is at least once. Every externally visible or billable side effect uses a stable key, durable journal and compare-and-swap/fencing check.
- Each capture attempt selects exactly one effective region, endpoint class and sticky endpoint/session binding. PostgreSQL persists a private opaque affinity handle plus an HMAC digest of the raw endpoint/session tuple; raw identifiers remain secret and never enter events/datasets/public responses. Every standardized HTTP, browser and media action proves the same digest before its write. On restart the engine must reacquire the same sticky binding; if it cannot prove continuity, it fences/discards the whole attempt and restarts at page one.
- A failed attempt is discarded in full. A retry starts at page one in a new staging namespace and cannot merge items, cursors or artifacts from another endpoint/attempt into one logical snapshot. Only one successful attempt can supply a published dataset.

Minimum relational entities/constraints are: `scraper_runs` (unique run ID and `(project_id,idempotency_key)`, stored request hash, state/version/cancellation flag); `request_recipes` (immutable recipe/fingerprint per attempt); `scraper_attempts` (unique run/attempt, fence, safe region/class, outcome); `dispatch_outbox` (durable queue replay source); `scraper_events` (unique run/sequence and event ID); `budget_reservations` (unique stable billable-action key with reserve/settle/release amounts); `dataset_receipts`; `artifact_manifest_entries`; `import_acknowledgements`; and `cleanup_receipts`. All foreign keys are project/run scoped, terminal receipts are immutable, and no table has a cookie/token/session-secret column.

## Leases, atomic sealing and deterministic checksums

- Lease owner, expiry, generation and monotonically increasing fencing token are issued and CAS-validated exclusively in PostgreSQL. Every state, attempt, staging, event, sealing and billing write validates the current PostgreSQL token. Redis may mirror delivery/visibility only; its loss or stale contents can never authorize work.
- In-progress items/artifacts live under an attempt-specific staging namespace. `sealing_started` is a state-version CAS into `sealing`; no worker may add data after its sealing barrier.
- Seal only after every worker has acknowledged completion, counts reconcile and all advertised artifact bytes pass size/hash/type checks. CAS-promote the one accepted attempt into an immutable published namespace; failures retain/reconcile staging and never expose a half-sealed dataset.
- Use the following immutable versioned checksum envelopes; every SHA-256 is lowercase hex prefixed `sha256:` and the field holding an envelope's own checksum/signature is excluded from its hash:
  - `CaptureItemSealV1`: every contract capture-item semantic field plus immutable artifact references `{artifact_id,kind,sha256,byte_size,detected_media_type}`, excluding transport path/expiry and `item_checksum` itself.
  - `ResolutionCandidateSealV1`: every candidate semantic/evidence field plus immutable artifact references, excluding transport path/expiry and candidate checksum itself. Confidence is integer `confidence_micros` (0–1,000,000), never a float.
  - `ArtifactManifestV1`: `{schema_version,run_id,entries:[{artifact_id,kind,sha256,byte_size,detected_media_type}]}` sorted by `artifact_id` UTF-8 bytes.
  - `DatasetSealV1`: `{schema_version,contract_version,kind,run_id,engine_revision,capability_digest,profile_revision,adapter_revision,request_recipe_id,schema_fingerprint,requested_scope,effective_scope,requested_scope_hash,effective_scope_hash,coverage,terminal_stop_receipt,acquisition_receipt,budget_receipt,warnings,item_checksums,artifact_manifest_checksum}`.
- Full semantic warnings—not only codes—are hashed as `{code,scope,item_id,reason_code,release_effect}` sorted by that tuple; `safe_message` is excluded as presentation text. Capture items sort by generic provider ad ID, UTC source start time, creative-variant hash, platform and stable item ID. Resolution candidates sort by provider, public page ID, descending `confidence_micros`, reason-code tuple and stable candidate ID. The ordered item/candidate checksum array is bound into `DatasetSealV1`.
- JCS-canonicalize each exact envelope and hash its UTF-8 bytes. The dataset signature input is exactly `{algorithm:"DatasetSignatureV1",contract_version,project_id,run_id,kind,dataset_checksum}`, JCS-encoded as UTF-8 and signed with Ed25519. `dataset_receipt` exposes `signature_algorithm: "Ed25519"`, `signature_key_id` and a base64url-without-padding `dataset_signature`; these fields are outside `DatasetSealV1` and its checksum. Contract fixtures publish capture, resolution, item, artifact-manifest, warning, dataset and signature vectors in two languages, including reordered inputs, invalid key IDs and one-field tamper failures.

## Atomic multi-dimensional budgets and deadlines

- Required limits include `max_queue_seconds`, `max_execution_seconds`, `absolute_deadline` and `max_provider_cost_usd_micros`.
- PostgreSQL is authoritative for one run budget ledger covering provider cost, provider-request count, total streamed bytes, pages/items/media ceilings and concurrent worker slots. Every claim includes stable action key and current fence; one atomic conditional update refuses any cap breach before the side effect.
- Before a provider request, atomically claim one request and reserve its conservative maximum cost. Settle actual cost and release only proven unused reservation. Streamed bodies claim bounded byte chunks before accepting/writing each chunk; abort before a chunk that would exceed remaining bytes. Concurrency slots are fenced leases and release only after worker stop/fence invalidation. Page/item/media counters claim before publication.
- Concurrent workers share the durable ledger; no local/Redis counter authorizes work. If an adapter cannot provide a safe maximum cost or action identity, it advertises no hard-cap support and is production-ineligible.
- A crash/timeout after dispatch but before trustworthy settlement consumes the full cost reservation and request claim unless the provider proves the action was not sent/billed. Never release an ambiguous claim. Sealing/terminal transition requires zero outstanding cost/byte/concurrency reservations and a complete per-dimension terminal budget receipt proving every used/reserved/released/refused total is within its cap.
- Queue time, execution time and absolute deadline are enforced separately. Deadline/cancellation first request cooperative stop, then force-terminate the isolated worker after a bounded grace period while stale fencing prevents later writes.

## API v1 endpoints

### Health and capabilities

```text
GET /versions
GET /v1/health
GET /v1/capabilities
```

`/versions` is the stable authenticated discovery endpoint. It requires the same mTLS client identity and bearer credential but no `X-Ad-Radar-Contract-Version` header. It returns exactly `{api: "ad-radar-scraper", request_id, supported_contract_versions: ["1.0"], preferred_contract_version: "1.0"}`.

`/health` proves the gateway process can safely accept/reconcile work using its authoritative ledger, queue/outbox and artifact store. It must not claim provider readiness unless checked.

`Health` 200 is exactly `{contract_version, request_id, status: ok | degraded, ledger: ok, queue: ok, artifact_store: ok, server_time}`. `degraded` is permitted only for a non-critical cleanup/metrics backlog while run acceptance/storage remain safe; unavailable ledger, queue/outbox or artifact storage returns the standard HTTP 503 error instead. Health contains no provider/profile list. `Capabilities` is `{contract_version, request_id, engine:{name,version,revision}, profiles:[ProfileCapability], features, verification_keys:[VerificationKey], server_time, capability_digest}`; each `ProfileCapability` carries a stable `profile_revision`, provider/adapter versions, allowed modes, requested-limit ceilings, `supports_hard_cost_cap`, `max_provider_cost_usd_micros`, concurrency ceiling and artifact/cancellation support. `VerificationKey` is exactly `{key_id,algorithm:"Ed25519",public_key_jwk,not_before,not_after,status:"active"|"retiring"}`. The digest is SHA-256 of the canonical, key-sorted authorized `engine + profiles + features + verification_keys` snapshot with profile/feature/key arrays sorted by stable ID/key ID; volatile `request_id`, `server_time` and the digest field itself are excluded. M1/deployment settings pin the initially trusted key ID and public-key fingerprint. Rotation first publishes overlapping old/new keys in a newly accepted capability digest, then signs with the new key only after the runtime has pinned it; a retiring key remains published and valid through the longest dataset/import retry window. An unknown, expired, not-yet-valid or digest-unpinned key makes the dataset unverifiable and release-ineligible.

`/capabilities` returns:

- contract versions;
- engine name/version/revision;
- provider adapters and exact provider API/browser adapter versions;
- only the configured non-secret profile aliases authorized for the authenticated runtime credential;
- supported resolution/capture modes;
- maximum limits/concurrency, `supports_hard_cost_cap`, maximum enforceable provider cost and cost-receipt support;
- event, dataset, artifact and cancellation support;
- server time and capability digest.

### Source resolution

```text
POST /v1/resolution-runs
GET  /v1/resolution-runs/{run_id}
GET  /v1/resolution-runs/{run_id}/events?after={sequence}&limit={n}
GET  /v1/resolution-runs/{run_id}/candidates?cursor={cursor}&limit={n}
GET  /v1/resolution-runs/{run_id}/artifacts/{artifact_id}
POST /v1/resolution-runs/{run_id}/cancel
POST /v1/resolution-runs/{run_id}/acknowledgements
```

Resolution input is an allowlisted public identity—advertiser/agency name, known public website/domain, country/market and optional known provider page ID. It is not an arbitrary URL-fetch endpoint.

### Ad capture

```text
POST /v1/capture-runs
GET  /v1/capture-runs/{run_id}
GET  /v1/capture-runs/{run_id}/events?after={sequence}&limit={n}
GET  /v1/capture-runs/{run_id}/items?cursor={cursor}&limit={n}
GET  /v1/capture-runs/{run_id}/artifacts/{artifact_id}
POST /v1/capture-runs/{run_id}/cancel
POST /v1/capture-runs/{run_id}/acknowledgements
```

All create/cancel/acknowledge endpoints are authenticated idempotent mutations. Create has no `expected_version`; cancel and acknowledgement require it in the JSON body. Resolution and capture use the same common run/event/artifact/mutation envelopes; their dataset page schemas differ.

### Endpoint response matrix

| Endpoint | Success | Body/schema | Special response |
| --- | --- | --- | --- |
| `GET /versions` | 200 | `VersionDiscovery` | authenticated discovery; no version header |
| `GET /health` | 200 | `Health` | 503 `dependency_unavailable` if ledger, queue/outbox or artifact store is unavailable |
| `GET /capabilities` | 200 | `Capabilities` filtered by the caller | 503 if capability truth cannot be established |
| either run `POST` | 202 | `RunAccepted` for both first accept and exact replay | 409 idempotency conflict; pre-accept 429/503 creates no run |
| either run `GET` | 200 | `RunDetail` | 404 scoped absence |
| either events `GET` | 200 | `EventPage` | numeric `after` sequence; no opaque cursor |
| candidates/items `GET` | 200 | `CandidatePage`/`CaptureItemPage` | 409 `dataset_not_sealed` before terminal sealing |
| artifact `GET` | 200/206 | gateway-proxied authorized bytes with fixed headers below | 410 `artifact_expired` after byte expiry |
| either cancel `POST` | 202 | `MutationReceipt` | 409 only for a new invalid transition |
| either acknowledgement `POST` | 200 | `AcknowledgementReceipt` | 409 manifest/count/version mismatch |

Every successful versioned JSON response includes `contract_version` and `request_id`; errors and discovery follow their separately defined schemas. `RunAccepted`, `RunDetail`, `MutationReceipt` and `AcknowledgementReceipt` include `run_id`, `project_id` and `kind: resolution | capture`; list JSON includes `run_id`; byte responses use the fixed HTTP headers below. Acceptance/mutation receipts retain the status/version produced by that mutation and separately report `current_status/current_version`, so replay is unambiguous. The OpenAPI/JSON Schemas must make all required/nullable fields explicit and reject undeclared fields where security or idempotency semantics depend on canonical bytes.

## Request headers and authentication

Every request requires mandatory mutual TLS using the runtime client identity plus a defense-in-depth bearer credential. All endpoints except `/versions` also require the version header:

```text
Authorization: Bearer <service credential>
X-Request-Id: <UUID>
```

```text
X-Ad-Radar-Contract-Version: 1.0
```

Every mutation also requires:

```text
Idempotency-Key: <stable opaque key, 16..200 chars>
```

Rules:

- Production TLS is mutual. The only accepted client SAN is the deployed runtime identity (target `spiffe://frank.fail/ad-radar-runtime`, with any environment-specific replacement frozen in deployment configuration and the receipt). Plain HTTP is allowed only on loopback in automated tests.
- Credentials are provided through a secret file/store and identified in configuration by alias/key ID.
- Never log authorization, signed artifact tokens, cookie/session contents or provider credentials.
- A service credential maps server-side to allowed project/profile IDs and rate limits.
- Project/run/body identifiers do not grant access by themselves.
- Support overlapping old/new credentials for rotation and record only key ID in audit logs.
- The gateway authorizes the intersection of client-certificate identity and bearer-key project/profile/action grants. Any other certificate, bearer-only caller or scope mismatch is rejected.
- Unsupported/missing versions on versioned endpoints return HTTP 426 `unsupported_contract_version` with safe details `{supported_contract_versions:["1.0"], preferred_contract_version:"1.0"}`. Connection negotiation always calls `/versions` first, then the selected `/v1/capabilities`.
- For every mutation, resolve a prior `(project_id, idempotency_key)` result before evaluating `expected_version`. This makes exact cancel/ack replay succeed even after the first mutation advanced the run version.
- `expected_version` appears only in cancel/ack JSON bodies. It is not accepted in headers or query parameters.
- Mutation idempotency tombstones outlive the declared 30-day client retry window.

Freeze the mutation hash as `IdempotencyMaterialV1`:

```text
{
  algorithm: "IdempotencyMaterialV1",
  contract_version: "1.0",
  method: "POST",
  route_template,
  project_id,
  resource: null | {kind, run_id},
  mutation: "create" | "cancel" | "acknowledge",
  body
}
```

- `route_template` is exactly one of `/v1/resolution-runs`, `/v1/capture-runs`, `/v1/resolution-runs/{run_id}/cancel`, `/v1/capture-runs/{run_id}/cancel`, `/v1/resolution-runs/{run_id}/acknowledgements`, or `/v1/capture-runs/{run_id}/acknowledgements`; mutation endpoints reject query parameters. `resource` is null for create and otherwise binds the path's kind and normalized run ID. Cancel/ack project ID is the authorized project stored on that run.
- `body` is the strict validated JSON request body with only the correlation-only `request_id` member removed. Thus all create semantics—including tool/logical/stage IDs, settings/profile/capability revisions, identity/source and every limit—and all cancel/ack semantics—including `expected_version`, reason, checksums, counts and canonical import receipt ID—are bound. `contract_version` remains in the body and must equal the header/envelope version.
- Method, route, resolved project/resource, mutation and body are RFC 8785/JCS-canonicalized as the envelope above; `request_hash` is lowercase `sha256:` plus SHA-256 of its UTF-8 bytes. Persist both algorithm and hash.
- Exclude `X-Request-Id`/body `request_id`, `Idempotency-Key`, Authorization, mTLS identity/material, credential/key IDs, tracing, User-Agent, forwarding/network headers and raw byte formatting. Credential or signing-key rotation therefore does not change mutation identity. The idempotency key remains the journal lookup key, not hash material.
- Publish two-language fixtures for every route, body-key reordering, changed request ID, credential/key rotation, and one-field semantic/path/method/project/run changes. Reordering and excluded-field changes must preserve the hash; every bound-field change must change it.

Cancel body and response:

```json
{
  "contract_version": "1.0",
  "expected_version": 4,
  "reason_code": "operator_cancelled"
}
```

```json
{
  "contract_version": "1.0",
  "request_id": "uuid",
  "run_id": "scrape-run-id",
  "project_id": "opaque-project-id",
  "kind": "capture",
  "mutation": "cancel",
  "accepted": true,
  "status": "running",
  "cancellation_requested": true,
  "version": 5,
  "current_status": "running",
  "current_version": 5,
  "reused": false
}
```

## Start-resolution request

```json
{
  "contract_version": "1.0",
  "request_id": "uuid",
  "project_id": "opaque-project-id",
  "tool_run_id": "hermes-run-id",
  "logical_acquisition_id": "stable-logical-id",
  "stage_attempt_id": "attempt-id",
  "settings_revision": 12,
  "settings_digest": "sha256:...",
  "profile_alias": "meta-public-ads-au",
  "expected_profile_revision": "profile-revision-id",
  "expected_capability_digest": "sha256:...",
  "identity": {
    "display_name": "Public advertiser name",
    "known_domain": "example.com",
    "country": "AU",
    "market": "AU",
    "known_provider_page_id": null
  },
  "limits": {
    "max_candidates": 10,
    "max_provider_requests": 30,
    "max_total_bytes": 10485760,
    "max_queue_seconds": 60,
    "max_execution_seconds": 300,
    "absolute_deadline": "RFC3339 timestamp",
    "max_provider_cost_usd_micros": 250000
  }
}
```

All identity fields are bounded strings. At least `display_name`, `known_domain` or `known_provider_page_id` is required. `known_domain` is a normalized public hostname—not a URL or fetch instruction.

## Start-capture request

Canonical logical shape; the JSON Schema is authoritative:

```json
{
  "contract_version": "1.0",
  "request_id": "uuid",
  "project_id": "opaque-project-id",
  "tool_run_id": "hermes-run-id",
  "logical_acquisition_id": "stable-logical-id",
  "stage_attempt_id": "attempt-id",
  "settings_revision": 12,
  "settings_digest": "sha256:...",
  "profile_alias": "meta-public-ads-au",
  "expected_profile_revision": "profile-revision-id",
  "expected_capability_digest": "sha256:...",
  "source": {
    "provider": "meta_ad_library",
    "page_id": "public-provider-page-id",
    "country": "AU",
    "active_status": "all",
    "date_min": null,
    "date_max": null
  },
  "limits": {
    "max_pages": 1,
    "max_items": 10,
    "max_media_per_item": 2,
    "max_total_bytes": 104857600,
    "max_queue_seconds": 120,
    "max_execution_seconds": 900,
    "absolute_deadline": "RFC3339 timestamp",
    "browser_concurrency": 1,
    "max_provider_requests": 100,
    "max_provider_cost_usd_micros": 1000000
  }
}
```

Validation rules:

- Strict object schemas; reject unknown security-sensitive fields.
- Provider/page/profile values must resolve to server-side allowlisted adapters, not URLs/commands.
- Limits are mandatory and may only be reduced by the server.
- A production profile is eligible only if it can hard-stop before `max_provider_cost_usd_micros` and return a complete provider cost receipt. If this is impossible, advertise `supports_hard_cost_cap: false`; the main runtime will refuse that profile.
- Dates and market must fit provider/profile policy.
- `settings_digest` is correlation evidence; the scraper does not fetch/activate project settings.
- Before journal acceptance, the gateway compares `expected_profile_revision` and `expected_capability_digest` to current authorized capability state. Drift returns HTTP 409 `capability_drift` and creates no run.
- The gateway constructs and hashes the exact `IdempotencyMaterialV1` envelope above before journal acceptance; no informal "semantic headers" set exists.

## Create response and idempotency

Return HTTP 202:

```json
{
  "contract_version": "1.0",
  "request_id": "uuid",
  "run_id": "scrape-run-id",
  "project_id": "opaque-project-id",
  "kind": "capture",
  "status": "queued",
  "version": 1,
  "current_status": "queued",
  "current_version": 1,
  "request_hash": "sha256:...",
  "reused": false,
  "requested_limits": {
    "max_pages": 1,
    "max_items": 10,
    "max_media_per_item": 2,
    "max_total_bytes": 104857600,
    "max_queue_seconds": 120,
    "max_execution_seconds": 900,
    "absolute_deadline": "RFC3339 timestamp",
    "browser_concurrency": 1,
    "max_provider_requests": 100,
    "max_provider_cost_usd_micros": 1000000
  },
  "effective_limits": {
    "max_pages": 1,
    "max_items": 10,
    "max_media_per_item": 2,
    "max_total_bytes": 104857600,
    "max_queue_seconds": 120,
    "max_execution_seconds": 900,
    "absolute_deadline": "RFC3339 timestamp",
    "browser_concurrency": 1,
    "max_provider_requests": 100,
    "max_provider_cost_usd_micros": 1000000
  },
  "limit_clamps": [],
  "created_at": "RFC3339 timestamp"
}
```

Persist exactly one journal row unique on `(project_id, idempotency_key)` with `request_hash_algorithm=IdempotencyMaterialV1` and the canonical request hash before enqueueing work. Do not include `request_hash` in the uniqueness key.

- Same project/key/hash returns the same run with `reused: true`.
- Same project/key with a different hash returns HTTP 409 `idempotency_conflict` and creates nothing.
- A client timeout is not permission to create another run; GET/repeat with the same key must reconcile it.
- Internal worker retries belong to the same scrape run and are visible as attempts/events.
- A transport retry uses identical bytes/key. A runtime stage retry has a new `stage_attempt_id` and mutation key but the same `logical_acquisition_id`. An operator recapture uses a new logical acquisition. The scraper returns the new `run_id`; it never manufactures the upstream IDs.

`limit_clamps` entries are `{field, requested, effective, reason_code}`. Create and run-detail responses always echo complete requested/effective limits, even when no clamp occurred. The durable run also stores/returns immutable `requested_scope` and `effective_scope` objects using the frozen `Scope` schema (`scope_version`, exactly one `source | identity`, and the complete corresponding limits). Coverage hashes must equal SHA-256 of their RFC 8785/JCS encodings; the runtime recomputes both before import.

## Run-detail and page envelopes

Both run kinds return this required logical `RunDetail` shape; fields that do not apply are explicitly nullable in JSON Schema:

```json
{
  "contract_version": "1.0",
  "request_id": "uuid",
  "run_id": "scrape-run-id",
  "project_id": "opaque-project-id",
  "kind": "capture",
  "logical_acquisition_id": "stable-logical-id",
  "stage_attempt_id": "attempt-id",
  "status": "succeeded",
  "version": 8,
  "requested_scope": {
    "scope_version": "1.0",
    "source": {"provider": "meta_ad_library", "page_id": "public-provider-page-id", "country": "AU", "active_status": "all", "date_min": null, "date_max": null},
    "limits": {"max_pages": 1, "max_items": 10, "max_media_per_item": 2, "max_total_bytes": 104857600, "max_queue_seconds": 120, "max_execution_seconds": 900, "absolute_deadline": "RFC3339 timestamp", "browser_concurrency": 1, "max_provider_requests": 100, "max_provider_cost_usd_micros": 1000000}
  },
  "effective_scope": {
    "scope_version": "1.0",
    "source": {"provider": "meta_ad_library", "page_id": "public-provider-page-id", "country": "AU", "active_status": "all", "date_min": null, "date_max": null},
    "limits": {"max_pages": 1, "max_items": 10, "max_media_per_item": 2, "max_total_bytes": 104857600, "max_queue_seconds": 120, "max_execution_seconds": 900, "absolute_deadline": "RFC3339 timestamp", "browser_concurrency": 1, "max_provider_requests": 100, "max_provider_cost_usd_micros": 1000000}
  },
  "requested_limits": {"max_pages": 1, "max_items": 10, "max_media_per_item": 2, "max_total_bytes": 104857600, "max_queue_seconds": 120, "max_execution_seconds": 900, "absolute_deadline": "RFC3339 timestamp", "browser_concurrency": 1, "max_provider_requests": 100, "max_provider_cost_usd_micros": 1000000},
  "effective_limits": {"max_pages": 1, "max_items": 10, "max_media_per_item": 2, "max_total_bytes": 104857600, "max_queue_seconds": 120, "max_execution_seconds": 900, "absolute_deadline": "RFC3339 timestamp", "browser_concurrency": 1, "max_provider_requests": 100, "max_provider_cost_usd_micros": 1000000},
  "limit_clamps": [],
  "warnings": [],
  "cancellation_requested": false,
  "terminal_error": null,
  "engine_revision": "immutable-engine-revision",
  "capability_digest": "sha256:...",
  "profile_revision": "profile-revision-id",
  "adapter_revision": "provider-adapter-revision",
  "acquisition_receipt": {
    "engine_revision": "immutable-engine-revision",
    "capability_digest": "sha256:...",
    "profile_revision": "profile-revision-id",
    "adapter_revision": "provider-adapter-revision",
    "request_recipe_id": "recipe-id",
    "schema_fingerprint": "sha256:...",
    "provider_evidence_checksum": "sha256:...",
    "effective_region": "au-west",
    "endpoint_class": "residential",
    "coverage": {
      "complete": true,
      "stop_reason": "source_exhausted",
      "requested_scope_hash": "sha256:...",
      "effective_scope_hash": "sha256:...",
      "pages_started": 1,
      "pages_completed": 1,
      "items_observed": 8,
      "items_emitted": 8,
      "duplicates_removed": 0,
      "media_expected": 12,
      "media_acquired": 12,
      "pagination_exhausted": true,
      "pagination_outcome": "exhausted",
      "last_cursor_hash": null,
      "attempt_count": 1,
      "warnings": []
    }
  },
  "terminal_stop_receipt": {
    "stop_reason": "source_exhausted",
    "attempt_count": 1,
    "final_attempt_id": "attempt-id",
    "request_recipe_id": "recipe-id",
    "schema_fingerprint": "sha256:...",
    "requested_scope_hash": "sha256:...",
    "effective_scope_hash": "sha256:...",
    "pages_started": 1,
    "pages_completed": 1,
    "items_observed": 8,
    "items_emitted": 8,
    "media_expected": 12,
    "media_acquired": 12,
    "effective_region": "au-west",
    "endpoint_class": "residential"
  },
  "dataset_receipt": {
    "sealed": true,
    "item_count": 8,
    "artifact_count": 12,
    "dataset_checksum": "sha256:...",
    "artifact_manifest_checksum": "sha256:...",
    "signature_algorithm": "Ed25519",
    "signature_key_id": "engine-release-key-id",
    "dataset_signature": "base64url-without-padding"
  },
  "budget_receipt": {
    "currency": "USD",
    "caps": {"provider_cost_usd_micros": 1000000, "provider_requests": 100, "total_bytes": 104857600, "pages": 1, "items": 10, "media": 20, "concurrency": 1},
    "used": {"provider_cost_usd_micros": 100000, "provider_requests": 12, "total_bytes": 3456789, "pages": 1, "items": 8, "media": 12},
    "peak_reserved": {"provider_cost_usd_micros": 100000, "bytes": 1048576, "concurrency": 1},
    "released_unused": {"provider_cost_usd_micros": 0, "bytes": 512},
    "outstanding_reserved": {"provider_cost_usd_micros": 0, "bytes": 0, "concurrency": 0},
    "refused_claims": {"provider_cost": 0, "provider_requests": 0, "bytes": 0, "concurrency": 0},
    "budget_exhausted": false,
    "complete": true
  },
  "created_at": "RFC3339",
  "started_at": "RFC3339",
  "terminal_at": "RFC3339",
  "artifact_availability": "available",
  "artifacts_available_until": "RFC3339"
}
```

`artifact_availability` is required and is `none | available | acknowledged_cleanup | expired`; failed/cancelled/discarded runs with no published artifacts use `none`, and `artifacts_available_until` is nullable after cleanup/expiry or when none exist. The actual engine/capability/profile/adapter revisions are required on every accepted run and must equal the values bound at acceptance.

`acquisition_receipt.coverage.pagination_outcome` is the authoritative pagination result. `exhausted` proves the recipe-validated provider result reported no continuation. `effective_bound_reached` means the server cleanly completed the accepted bound and may have observed a continuation; it is clean for a non-zero bounded capture and emits informational `bounded_scope_reached`. `interrupted` means failure/throttle/timeout stopped work before the accepted scope completed and is partial/permanently ineligible. A clean zero result follows the stricter coverage rule above and also requires a non-empty provider-evidence checksum and complete budget receipt.

Terminal `failed`/`discarded` requires `terminal_error: {category, code, safe_message, retryable, retry_after_seconds}` and has no consumable dataset. Category is exactly `transport | source_schema | access | cost_time_limit | validation | storage | cancellation | internal`.

Frozen terminal error codes are `profile_unavailable`, `transport_retry_exhausted`, `provider_auth_failed`, `provider_rate_limited`, `provider_blocked`, `access_restricted`, `verification_required`, `session_expired`, `source_schema_changed`, `queue_deadline_exceeded`, `execution_deadline_exceeded`, `provider_budget_exhausted`, `safety_limit_exceeded`, `response_validation_failed`, `dataset_integrity_failed`, `artifact_integrity_failed`, `stale_fence_detected`, `attempt_contamination_detected`, `storage_unavailable`, `cancel_cleanup_failed`, and `internal_error`. Unknown internal/provider errors map to `internal_error`; raw upstream text is never exposed. Adding a code requires a compatible contract minor and older clients must fail closed.

Candidate/item endpoints use exactly `{contract_version, request_id, run_id, items, next_cursor, has_more}`. Their `next_cursor` is nullable/opaque, binds run/dataset version/page size, and a changed/expired cursor returns 409 `cursor_invalid` rather than restarting. Event endpoints instead use `{contract_version, request_id, run_id, events, after_sequence, last_sequence, has_more}`; clients continue with `after={last_sequence}` and no event cursor exists. The final sealed candidate/item page also repeats `dataset_checksum`.

### State-discriminated `RunDetail` and dataset actions

The JSON Schema is a `oneOf` discriminated by `status`. Common fields are always required: all IDs, `status/version`, `cancellation_requested`, accepted revisions/digest, requested/effective scopes and complete limits, clamps, warnings, creation time and artifact availability.

| State | Required | Must be null/absent | Dataset/items/artifacts/ack |
| --- | --- | --- | --- |
| `queued` | `budget_progress`, queue deadline | acquisition/dataset/terminal-stop/terminal-error/final-budget/terminal time | 409 `dataset_not_sealed`; ack 409 |
| `running` | `progress_receipt`, `budget_progress`, started time | acquisition/dataset/terminal-stop/terminal-error/final-budget/terminal time | 409 `dataset_not_sealed`; ack 409 |
| `sealing` | finalizing `progress_receipt`, `budget_progress`, started time | published dataset/terminal-stop/terminal-error/final-budget/terminal time | 409 `dataset_not_sealed`; ack 409 |
| `succeeded` | acquisition with `coverage.complete=true`, `terminal_stop_receipt`, dataset receipt, complete final budget receipt, started/terminal times | terminal error | 200 dataset/artifacts; ack allowed |
| `succeeded_partial` | acquisition with `coverage.complete=false`, permanent warning, `terminal_stop_receipt`, dataset receipt, complete final budget receipt, started/terminal times | terminal error | 200 dataset/artifacts for quarantine/evidence; ack allowed; release forbidden |
| `failed` | `terminal_stop_receipt`, complete final budget receipt, terminal error, terminal time | acquisition/dataset receipt | 409 `no_dataset`; artifact availability `none`; ack 409 `no_dataset` |
| `cancelled` | `terminal_stop_receipt.stop_reason=cancelled`, complete final budget receipt, terminal time | acquisition/dataset/terminal error | 409 `no_dataset`; artifact availability `none`; ack 409 `no_dataset` |
| `discarded` | `terminal_stop_receipt`, complete final budget receipt, integrity/fence terminal error, terminal time | acquisition/dataset receipt | 409 `no_dataset`; artifact availability `none`; ack 409 `no_dataset` |

`terminal_stop_receipt` is required for every terminal accepted run, even when nothing was sealed. It contains stop reason, attempt count/final attempt, recipe ID/fingerprint if discovered, requested/effective scope hashes, final page/item/media counters and safe region/class; nullable recipe/region fields are allowed only when failure occurred before discovery/endpoint assignment. `progress_receipt`/`budget_progress` are explicitly non-final snapshots. Every terminal `budget_receipt` is settled/complete, including a zero-cost queued cancellation. No-dataset terminal endpoints never masquerade as 404 or empty arrays.

## Run states

Only these values are valid:

```text
queued
running
sealing
cancelled
succeeded
succeeded_partial
failed
discarded
```

Terminal states are `cancelled`, `succeeded`, `succeeded_partial`, `failed`, and `discarded`.

- `queued` and `running` cover accepted/waiting and active acquisition. `sealing` begins only after the fencing/CAS barrier and forbids further data writes.
- `succeeded` means accepted effective record scope completed, `coverage.complete=true`, the dataset was sealed and every advertised artifact exists/checksums. It may carry informational or optional-media warnings.
- A truthful zero-item result may be `succeeded` only with provider response/pagination evidence proving zero matches.
- `succeeded_partial` means a valid useful dataset was sealed but `coverage.complete=false`; warnings/stop reason explain why. It is permanently release-ineligible and requires a clean recapture.
- `failed` means no consumable dataset exists because acquisition/access/schema/budget/time/internal work failed.
- `discarded` means the engine deliberately invalidated all run output after detecting stale fencing, cross-attempt contamination or sealing-integrity failure. It exposes no dataset and requires a terminal error receipt.
- A cancel mutation sets durable `cancellation_requested=true` and emits an event without creating a state. The current state remains `queued`, `running` or `sealing` until workers stop; only then transition to `cancelled` with no consumable dataset.

State transitions use optimistic `expected_version` plus the active fencing token; invalid/stale transitions return 409. The normal path is `queued → running → sealing → succeeded | succeeded_partial`; safety/failure/cancellation paths end in `failed | discarded | cancelled`.

Stop mapping is deterministic: `source_exhausted`, `zero_results_confirmed`, `max_items` and `max_pages` may end `succeeded` only when coverage rules pass; deadline/budget/rate/access/verification/session/browser interruption may end `succeeded_partial` only when a single attempt has a valid useful seal, otherwise `failed`; `source_schema_changed` fails and exposes no dataset; `cancelled` ends only after stop confirmation; integrity/fence/attempt contamination ends `discarded`. A transport/endpoint failure discards that entire attempt and retries from page one. A policy stop may seal partial output only if every emitted page/artifact came from the same still-valid attempt/endpoint.

### Rate-limit/failure transition matrix

| Condition | HTTP/run outcome | Release effect |
| --- | --- | --- |
| gateway capacity/provider throttle before acceptance | HTTP 429 + `Retry-After`; no run/journal acceptance | caller replays same key after delay |
| throttle after acceptance, no complete usable dataset | terminal `failed`, error `provider_rate_limited` | no import/release |
| throttle after acceptance with a valid partial dataset | `succeeded_partial`, warning `provider_rate_limited_partial`, coverage stop `rate_limited` | permanently ineligible; clean recapture required |
| clean provider evidence proving zero matches | `succeeded` with sealed zero receipt | eligible for downstream policy |
| cancellation | current active state + `cancellation_requested=true` → `cancelled` after workers stop | no dataset/release |
| optional media cannot be retrieved safely | `succeeded` + item warning `artifact_missing`; coverage media counts differ | runtime quarantine/exclusion policy |
| missing/corrupt advertised artifact or mixed/stale attempt | `discarded` + terminal integrity error | no dataset/release |

Warnings are metadata, never states. There are no `rate_limited`, `cancel_requested` or `succeeded_with_warnings` states.

### Structured warnings

Every warning is `{code, scope: run | item, item_id, reason_code, release_effect, safe_message}`; `item_id` is required only for item scope and otherwise null. `reason_code` is required for `artifact_missing` and is exactly `session_validation_failed | host_not_allowed | dns_blocked | redirect_blocked | not_found | timeout | byte_limit_exceeded | dimension_limit_exceeded | duration_limit_exceeded | mime_rejected | decode_failed`; it is nullable for other codes. Frozen v1 codes/effects:

| Code | Effect |
| --- | --- |
| `bounded_scope_reached` | `informational` when the requested effective bound was cleanly completed |
| `artifact_missing` | `review_resolvable`; includes structured reason and runtime may quarantine/exclude affected items and recompute |
| `provider_field_missing` | `review_resolvable`; runtime decides required-field policy |
| `pagination_incomplete` | `permanently_ineligible` |
| `provider_rate_limited_partial` | `permanently_ineligible` |
| `provider_auth_degraded` | `permanently_ineligible` |
| `evidence_incomplete` | `permanently_ineligible` |

Unknown warning codes fail closed as `permanently_ineligible`. The engine reports effects; only the runtime applies canonical quarantine/release policy, and it cannot override a permanent effect.

## Ordered events

Each run has monotonically increasing `sequence` starting at 1 and immutable events:

```json
{
  "sequence": 7,
  "event_id": "uuid",
  "run_id": "scrape-run-id",
  "type": "page_completed",
  "occurred_at": "RFC3339 timestamp",
  "attempt": 1,
  "safe_message": "Captured page 1",
  "counters": {
    "pages_requested": 1,
    "pages_completed": 1,
    "items_observed": 8,
    "artifacts_stored": 12,
    "bytes_stored": 3456789
  }
}
```

No event may contain credentials, cookies, raw HTML/payloads, proxy addresses, artifact tokens or private paths. Pagination uses `after` plus a bounded `limit` (default 100, maximum 500). Re-reading events returns identical contents/order.

Only these v1 event types are valid: `run_queued`, `worker_started`, `source_resolved`, `page_started`, `page_completed`, `item_observed`, `artifact_stored`, `limit_reached`, `warning`, `cancellation_requested`, `attempt_discarded`, `sealing_started`, `run_cancelled`, `dataset_sealed`, `run_succeeded`, `run_succeeded_partial`, `run_failed`, `run_discarded`. Every terminal event carries the required terminal `status`. PostgreSQL assigns sequence centrally per run with one durable atomic increment/insert transaction; workers never invent sequence numbers. New event types require a compatible contract release and must be ignorable by older v1 consumers.

## Sealed dataset items

Items are unavailable until the run is terminal and the dataset is sealed, or are explicitly marked provisional and never imported as canonical. Prefer terminal-only v1 reads.

Each capture item includes:

- stable scraper item ID;
- provider and provider ad ID;
- resolved public page ID/name;
- source observation timestamp and provider ad dates/status/markets;
- raw visible copy fields, CTA, public destination/source metadata;
- structured format/media descriptors;
- artifact references for raw evidence and media;
- adapter/engine version and evidence receipt ID;
- item checksum.

It does **not** include:

- a canonical creative/version/release ID;
- classification or confidence about product taxonomy;
- `qa_passed`, approval or publish eligibility;
- contacts/prospects/outreach data;
- secrets, cookies, proxy/session data or host paths.

The engine may report `reported_environment` or `reported_synthetic` only as optional informational provenance. The runtime adapter/profile/environment stamps authoritative fixture-versus-external lineage; the scraper payload can never make fixture data production-eligible.

Items endpoint is cursor-paginated, deterministic and bounded (default 50, maximum 250). A sealed dataset has an immutable dataset checksum and count. The same cursor/request returns the same items.

## Session-bound media retrieval hierarchy

For each media reference, use exactly this order within the same attempt/network profile:

1. Stream with the standardized HTTP client through the approved run network profile.
2. Only when the source rejects that request because session validation is required, retrieve inside the already active browser context. Tokens/cookies remain browser-memory-only and are never copied to a request object, ledger, Redis, event or log.
3. If both safe paths fail, omit the artifact and emit item-scoped `artifact_missing` with reason `session_validation_failed | host_not_allowed | dns_blocked | redirect_blocked | not_found | timeout | byte_limit_exceeded | dimension_limit_exceeded | duration_limit_exceeded | mime_rejected | decode_failed`.

At every hop, validate scheme, approved provider/CDN hostname, DNS answer/public IP and redirect target. Stream while enforcing actual compressed/decompressed byte ceilings; `Content-Length` is only a hint. Sniff and allowlist actual MIME, reject declaration mismatch/polyglots, and enforce configured pixel dimensions/video duration before advertising the artifact. These are acquisition-safety checks, not canonical media QA—the runtime still validates imported bytes independently.

## Artifacts

Each artifact descriptor includes:

```text
artifact_id
kind: raw_evidence | image | video | document
sha256
byte_size
detected_media_type
created_at
hard_expires_at
download_path
```

Rules:

- `download_path` is only a stable relative path on this gateway. V1 never embeds or redirects to a signed/external URL, so deterministic dataset pages never expire or mutate.
- Artifact GET rechecks caller authorization/project/run scope and proxies bytes as 200/206. It returns `X-Ad-Radar-Contract-Version`, `X-Request-Id`, `X-Run-Id`, quoted checksum `ETag`, RFC 9530 `Content-Digest`, validated `Content-Type`, `Content-Length`, `Content-Disposition: attachment`, `Accept-Ranges: bytes` and `Cache-Control: private, no-store`. HTTP 206 additionally requires RFC-valid `Content-Range`; its `Content-Length` is the selected range length, not total artifact size.
- Support streaming/range where useful, but enforce total-byte limits.
- Preserve source bytes. `detected_media_type` is the allowlisted sniffed type and is the sole media-type field in public descriptors, item artifact references and `ArtifactManifestV1`; any upstream declared type remains private acquisition evidence. This does not claim canonical decode/QA—that happens after import.
- Raw evidence is private and never embedded inline in normal item/event responses.
- Dataset/artifact bytes remain available until one hour after the first valid acknowledgement, with a hard maximum of seven days after terminal completion. Before acknowledgement they are never deleted earlier than seven days; after the hard maximum, artifact GET returns 410.
- Run/event/dataset-receipt/acknowledgement metadata and idempotency tombstones remain for 180 days. Historical run details retain `artifact_availability: none | available | acknowledged_cleanup | expired` after bytes are gone.
- Cleanup is restart-safe and records a receipt. The client retry window is 30 days, so the 180-day tombstone prevents late duplicate mutation.
- Acknowledgement binds run, dataset checksum, artifact-manifest checksum, imported item/artifact counts and canonical import receipt ID; mismatches return 409.

Acknowledgement body and response:

```json
{
  "contract_version": "1.0",
  "expected_version": 8,
  "dataset_checksum": "sha256:...",
  "artifact_manifest_checksum": "sha256:...",
  "imported_item_count": 8,
  "imported_artifact_count": 12,
  "canonical_import_receipt_id": "runtime-receipt-id"
}
```

```json
{
  "contract_version": "1.0",
  "request_id": "uuid",
  "run_id": "scrape-run-id",
  "project_id": "opaque-project-id",
  "kind": "capture",
  "acknowledgement_id": "ack-id",
  "accepted": true,
  "status": "succeeded",
  "version": 9,
  "current_status": "succeeded",
  "current_version": 9,
  "cleanup_eligible_at": "RFC3339",
  "reused": false
}
```

## Resolution results

Each candidate includes provider, public page ID/name, normalized public URL/domain evidence, confidence score, reason codes and evidence artifact references. The engine may rank candidates but the main runtime owns the canonical resolution decision/quarantine.

Low-confidence/ambiguous candidates are a successful resolution dataset, not a guessed winner. The engine must never silently choose when its configured ambiguity threshold is exceeded.

Resolution artifacts use the same descriptor, GET, acknowledgement and retention rules as capture artifacts. A sealed resolution receipt includes candidate count, dataset checksum and artifact-manifest checksum.

## Error contract

Every non-2xx response uses the stable error schema `{api: "ad-radar-scraper", request_id, code, message, retryable, retry_after_seconds, details}`; `details` is a bounded object and the two retry fields are nullable where inapplicable. Under a supported version it also includes `contract_version`; HTTP 426 instead includes requested/supported/preferred versions and deliberately does not claim a contract version.

| HTTP | Meaning |
| --- | --- |
| 400/422 | malformed or unsupported request |
| 401 | missing/invalid service credential |
| 403 | credential not authorized for project/profile/run |
| 404 | scoped resource absent |
| 409 | idempotency or expected-version conflict |
| 410 | artifact bytes expired; historical run/receipt metadata remains |
| 413 | request/artifact size policy exceeded |
| 426 | missing/unsupported contract version; return supported versions |
| 429 | pre-accept gateway/provider rate limit; include truthful retry-after and create no run |
| 503 | adapter/profile/dependency unavailable |
| 504 | bounded operation dependency timed out |

Internal exception strings, provider tokens/responses, HTML and paths never appear in the public error message.

## Networking and fetch safety

- Only configured provider origins/endpoints may be navigated as control requests.
- Prefer an official/public provider API or feed over browser automation when it provides the required public fields. Record the selected adapter/version and comply with the source's applicable access rules, robots policy and configured request cadence; do not bypass authentication or access controls.
- Apply per-provider pacing/backoff/concurrency ceilings before the global ceilings. Repeated throttling must reduce traffic and surface the structured outcomes above, not rotate identities indefinitely.
- Retry policy is configuration-bounded exponential backoff with jitter, maximum attempts and the earlier absolute deadline. Fixed sleeps and unbounded retries are forbidden. Per-domain token buckets and the attempt's single effective region/endpoint class apply to standard HTTP and browser requests alike.
- Resolution rejects schemes, URL credentials, ports, paths/query/fragment, IP literals, Unicode/lookalike host ambiguity and non-public suffixes. Normalize IDNA/Unicode for comparison and retain safe original text as evidence only.
- A supplied domain is a lookup hint, never permission for a direct arbitrary fetch. Any direct website evidence fetch must use a separately configured adapter allowlist and the same redirect/IP controls.
- For media/destination fetches, resolve DNS and block loopback, private, link-local, metadata, multicast and reserved ranges for every redirect/hop.
- Revalidate scheme/host/IP after redirects and DNS changes.
- Permit only HTTP/HTTPS needed by the adapter; block `file:`, `data:`, browser-extension and local protocols.
- Enforce connect/read/total timeouts, redirect count, compressed/decompressed bytes, MIME allowlist and concurrency.
- Isolate browser workers, run non-root, drop capabilities, use read-only filesystem and ephemeral per-run directories.
- Never make browser debug/control ports public.
- Treat provider documents/media as hostile; do not execute active content in previews.

The engine implements only the collection layer. It normalizes source-specific output into the frozen transfer schema, but it performs no LLM enrichment, business classification, feedback learning or canonical storage; those remain in the runtime/database owned by the main plan.

## Engine observability

Expose internal metrics/logs for:

- queue/running/terminal counts;
- stage and total latency;
- provider requests/status/rate limits;
- browser crashes/restarts;
- items/artifacts/bytes;
- warnings/failures/cancellations;
- idempotency reuse/conflicts;
- dataset/artifact retention/cleanup;
- contract/profile/version health.
- request-recipe fingerprints/schema-drift counts, coverage/stop reasons, attempts discarded by reason, lease/fence conflicts, budget reserved/settled/refused and sealing/recovery backlog.

Metric labels must not include raw URLs, ad copy, credentials, project names or any per-run/request/item ID. Use bounded provider/profile/status/code labels. Run/request IDs may appear only in access-controlled, retention-bounded logs and traces.

## Build dependency graph

```text
S-1 Feasibility spike (parallel with main M0; input to main M1)
  -> main M1 freezes contract
    -> S0 Pin contract and scaffold gateway
      -> S1 Single-worker vertical lifecycle proof
        -> S2 Durable auth/ledger/idempotency
          -> S3 Queues/leases/fencing/affinity/budgets
            -> S4 Public source resolution ------------------\
            -> S5 Ad capture, pagination and media -----------+-> S6 Atomic sealing/artifacts/ack/cleanup
                -> S7 Security/failure/load/conformance gates
                  -> S8 Package and deploy private candidate
                    -> S9 Joint contract/engine acceptance (pairs with main M10)
                      -> S10 Production-data rehearsal support (pairs with main M11)
                        -> S11 Promote/verify engine during main M12, before writer activation
```

S4 and S5 may run in parallel after S3 if they use separate modules and the same frozen schemas. S6 requires both branches complete; S7 requires S6.

## Implementation priority mapping

| Requested phase | Plan gate | Deliverable |
| --- | --- | --- |
| P0 Acquisition feasibility | S-1 | bounded browser spike: recipe discovery, structural validation, pagination, session replay, media fallback, clean zero and schema-drift classification |
| P1 Contract and fixtures | main M1 + S0 | schemas/state/error/coverage/JCS vectors/ack-retention fixtures frozen as v1.0.0 |
| P2 Single-worker vertical slice | S1 | request → browser → normalize → seal → import/verify → acknowledge → cleanup proof |
| P3 Durable orchestration | S2–S3 | PostgreSQL ledger, Redis queues, idempotency, leases/fencing, retries/cancel, atomic budget and endpoint affinity |
| P4 Media and production sealing | S5–S6 | hardened media hierarchy, immutable object/dataset publication and interrupted-seal recovery |
| P5 Scaling and security | S7–S11 | bounded load, isolation, canary, dashboards, production promotion and rollback |

---

## S-1 — Prove acquisition feasibility before the contract freeze

Run a disposable, bounded browser spike against one approved public test subject. This is the only scraper work that precedes main M1.

1. Discover a full secret-free request recipe: operation signature, encoding, variable/cursor paths, response item/pagination paths and structural fingerprint.
2. Prove structural validation on every response, including a deliberate fixture drift that terminates as `source_schema_changed` and never becomes zero.
3. Traverse at least two pages or exhaust the real source; record cursor hashes only.
4. Prove a positively confirmed empty result container using a controlled query/fixture.
5. Prove standard HTTP media retrieval, browser-context fallback for a session-bound asset and structured `artifact_missing` when both fail safely.
6. Demonstrate session tokens/cookies remain only in browser memory and are absent from saved recipes, fixtures, events, logs and disk/Redis/PostgreSQL snapshots.
7. Produce sanitized response-shape fixtures, a recipe/coverage proposal and a signed feasibility receipt with adapter/browser versions, bounds, findings and unresolved limitations. Do not retain provider payloads or real media beyond the approved evidence window.

### Exit criteria

Main M1 receives enough redacted evidence to freeze v1 without guessing the request shape, zero semantics or session-bound media behavior. Failure is reported truthfully and blocks only the affected provider/profile contract freeze.

---

## S0 — Pin the contract and scaffold the private gateway

1. Record the v1.0.0 artifact URL/version/SHA-256 supplied by the main build.
2. Verify checksum and generate server types/validators for recipe/`StructuralShapeV1`, scope, coverage, state/event/error, multidimensional budget/progress/terminal receipt, dataset/signature, artifact and acknowledgement schemas, including `IdempotencyMaterialV1`.
3. Add health/capability endpoints, structured safe errors and request IDs.
4. Create modules for API, auth, run store, worker dispatch, provider adapters, datasets, artifacts and observability.
5. Keep Apify-compatible/internal endpoints behind a separate boundary; do not expose them as the Ad Radar contract.
6. Add CI that rejects contract drift and committed secrets/data/browser profiles and verifies published RFC 8785/JCS checksum vectors.

### Exit criteria

Gateway boots, reports v1 capability, validates examples and contains no provider implementation yet.

---

## S1 — Prove the single-worker vertical lifecycle

Use one process/worker and disposable state to prove the frozen contract before distributed orchestration. This is a lifecycle proof, not production architecture.

1. Accept one bounded capture request and execute the S-1 adapter through recipe validation.
2. Normalize into contract items, apply deterministic ordering and build the required coverage, multidimensional `budget_receipt` and acquisition receipts.
3. Stage artifacts/items, enter `sealing`, create the RFC 8785/JCS checksum envelope and publish one immutable dataset.
4. Use the main repository conformance consumer to stream/verify/import it, submit acknowledgement and prove cleanup eligibility/expiry behavior.
5. Exercise clean non-empty, clean zero, effective bound, optional media loss, schema drift and interrupted capture without queues or concurrency.
6. Throw away the proof-only state afterward; do not promote in-memory/file orchestration into S2.

### Exit criteria

One end-to-end lifecycle and all truth/failure fixtures pass before PostgreSQL/Redis/worker scaling begins.

---

## S2 — Implement authentication, project/profile authorization and durable idempotent storage

1. Enforce the exact runtime client certificate SAN plus secret-file/store bearer keys with key IDs and rotation overlap.
2. Map the certificate/bearer intersection server-side to allowed projects/profiles/actions and quotas.
3. Implement the isolated PostgreSQL authoritative ledger and Redis non-authoritative roles exactly as specified; persist run, recipe/scope/attempt, every budget dimension/reservation, affinity handle/digest, seal/cleanup records, immutable versioned request hash, unique `(project_id,idempotency_key)` journal, versions and ordered events transactionally. Resolve replay before CAS for cancel/ack.
4. Implement create/get/events/candidates-or-items/artifacts/cancel/ack permission checks before resource lookup leakage.
5. Add per-key/project/profile rate and concurrency limits.
6. Redact structured/application/access logs and tracing.

### Required tests

- wrong/missing key, wrong project/profile/run;
- wrong/missing client certificate and a valid bearer presented by the wrong service identity;
- forged project body;
- same-key/same-hash reuse;
- same-key/different-hash 409;
- restart after accepted create;
- PostgreSQL remains authoritative when Redis is flushed/restarted; queue replay causes no duplicate side effect;
- session cookies/tokens are absent from PostgreSQL, Redis, logs, traces, errors and events;
- credential rotation/revocation;
- logs contain no seeded secret.

---

## S3 — Implement queues, leases, fencing, endpoint affinity and bounded state machine

1. Map each Ad Radar run to one internal actor/job while hiding internal IDs that are not contract IDs.
2. Enforce the exact v1 states/transitions, cancellation flag, optimistic version and fencing checks.
3. Assign ordered event sequence centrally and transactionally per run; concurrent workers cannot duplicate/reorder sequence.
4. Use at-least-once Redis delivery with PostgreSQL leases/fencing; stale workers cannot write or bill.
5. Apply request limits as hard ceilings in queue, browser, pagination, artifact and timeout layers.
6. Enforce atomic claim/reserve/settle/release for provider cost, provider requests, streamed bytes, page/item/media ceilings and concurrency; persist requested/effective limits, clamp reasons and a complete per-dimension `budget_receipt`.
7. Pin one region, endpoint class and sticky endpoint/session tuple per attempt through its private opaque affinity handle and HMAC digest; require the current attempt/fence/digest proof on every HTTP, browser, media and write action. If the same binding cannot be reacquired, fence/discard the attempt and restart from page one without cross-attempt merging.
8. Implement cooperative cancellation, forced bounded termination and cleanup.
9. Survive PostgreSQL/Redis/worker restart without losing accepted runs, duplicating active work or reusing stale fencing tokens.

### Exit criteria

Fixture workers prove every transition, limit, retry, budget reservation, endpoint-affinity, stale-fence, restart and cancellation case.

---

## S4 — Implement public-source resolution

1. Accept only the resolution schema’s public identity fields.
2. Query/navigate only configured provider/search sources.
3. Discover/validate a complete request recipe for any structured resolution response before producing ranked candidates with evidence, reason codes and measured confidence.
4. Preserve ambiguity; do not invent a definitive match.
5. Store raw resolution evidence as private temporary artifacts.
6. Cover no-match, one-match, ambiguous, clean zero, provider throttle, blocked, malformed and schema-drift cases.

### Exit criteria

Resolution endpoint passes v1 conformance and real bounded tests for at least one approved public subject.

---

## S5 — Implement ad capture, pagination and session-bound media

1. Use the requested provider/page/profile and current supported provider API/browser adapter.
2. Capture all requested public fields within bounds; record exact adapter/provider version.
3. Discover/validate the full request recipe, then follow pagination until exhausted or a declared bound/failure; schema drift fails closed.
4. Deduplicate within the dataset by provider ad ID + observation/content identity without erasing multiple observations.
5. Capture raw response/page evidence privately.
6. Execute the standardized HTTP → active browser-context → structured missing hierarchy under the same attempt network profile.
7. Emit truthful events/counters/warnings and the complete coverage object for the one accepted attempt.
8. A provider/version/backend/schema failure never becomes clean zero results; every failed attempt is discarded before a retry begins at page one.

### Exit criteria

Non-empty, positively confirmed zero, effective-bound, deadline/budget partial, rate-limited, access/session/schema and failed real cases behave exactly as v1 specifies. Standard and browser-context media paths plus every structured missing reason are covered.

---

## S6 — Atomically seal datasets and serve temporary artifacts

1. Implement RFC 8785/JCS checksum envelopes and cross-language vectors with the exact deterministic tie-breakers.
2. Use staging namespaces, CAS `sealing_started`, worker barriers and fencing; publish only after every worker stops writing and advertised artifacts exist.
3. Implement bounded cursor reads and authorized artifact streaming.
4. Validate coverage/count reconciliation, a complete budget receipt with zero outstanding cost, byte and concurrency reservations, the accepted attempt affinity digest, and actual stored byte/hash/`detected_media_type`/safety limits before sealing.
5. Implement import acknowledgement with checksum/count CAS.
6. Implement the exact seven-day byte, one-hour post-ack and 180-day metadata/tombstone retention clocks and cleanup receipts. V1 proxies artifacts and issues no signed URL.
7. Handle partial upload, disk-full, worker loss at the sealing barrier, stale fencing, corrupted artifact, acknowledgement retry and cleanup restart without exposing a half-sealed dataset.

### Exit criteria

Main conformance client can import and acknowledge a dataset repeatedly without changing it.

---

## S7 — Pass security, failure, conformance and load gates

Run the main repository’s published conformance suite unchanged. Also test:

- SSRF and redirect/DNS rebinding;
- private/metadata IP blocking;
- path/symlink traversal;
- MIME/polyglot/decompression/oversize attacks;
- browser isolation and debug-port exposure;
- auth/scope/replay/rate-limit failures;
- negative network reachability from public internet, browser and Frank service identity; only the runtime certificate may reach/authenticate;
- timeout at every boundary;
- request-recipe fingerprint drift, missing result containers and false-zero attempts;
- atomic budget races, queue/execution/absolute deadlines and reservation recovery;
- cross-region/endpoint attempt contamination and restart-from-page-one proof;
- stale fencing writes before/during/after sealing and interrupted CAS promotion recovery;
- JCS/checksum equality across both required language implementations;
- standard versus browser-context media retrieval, redirect/CDN validation and streamed real-byte ceilings;
- crash/restart during every state;
- duplicate delivery and event pagination;
- cancellation during navigation/pagination/download/sealing;
- bounded load at declared maximum concurrency;
- disk/queue/provider outage and recovery;
- log/error/metric redaction;
- dependency, image, secret and license scans.

No skipped required test, mock-only provider path, flaky result or secret-scan finding may pass.

---

## S8 — Package and deploy a private candidate

1. Build from a committed/pushed merge SHA.
2. Produce a non-root, health-checked OCI image with revision/source labels, pinned base digest and SBOM.
3. Scan/sign and publish by immutable digest.
4. Provision exact private DNS/TLS/port, isolated PostgreSQL/Redis, temporary dataset/artifact storage, secret path and retention job. Neither database has any canonical Ad Radar credential/network grant.
5. Configure the gateway to accept only the frozen runtime client SAN and keep all control/browser/debug ports private.
6. Configure one non-secret profile alias expected by Ad Radar.
7. Save deploy/rollback commands and previous image digest.
8. Verify `/health` and `/capabilities` from the actual Ad Radar runtime network and expose bounded operational dashboards for queue, leases/fences, attempts, schema drift, coverage/stop reasons, cost reservations and sealing/cleanup.

### Handoff packet to main agent

Provide:

- base origin (no credential);
- secret-store key ID/alias through the approved secret channel;
- contract version/artifact checksum;
- capability response/digest, profile alias and profile revision;
- image digest/revision/SBOM/scan receipts;
- conformance/security/load receipts;
- exact deploy/rollback and retention details;
- one safe test source/page ID approved for canary.

---

## S9 — Joint contract and real-engine acceptance (main M10)

With the main agent:

1. Pass health/capability/auth negotiation.
2. Resolve one approved public subject.
3. Capture one bounded non-empty run.
4. Prove recipe/fingerprint, coverage/scope, events, items, artifacts, atomic sealing, import and acknowledgement.
5. Force timeout after create and prove idempotent reconciliation.
6. Force warning, partial coverage, rate limit, schema drift, endpoint-attempt failure, budget race, stale fence, cancellation and corrupted-artifact cases.
7. Change capability/profile revision after negotiation and prove create fails closed with `capability_drift` before acceptance.
8. Verify canonical runtime—not scraper—creates IDs, classifications, QA and release.
9. Complete the authenticated Frank journey through a non-production real-engine run.

The main agent owns/signs the joint acceptance receipt. The scraper agent owns provider, conformance, security and load receipts and supplies their immutable references.

### Exit criterion

The engine is a replaceable, private, v1-conformant acquisition backend. Frank can configure/trigger/observe it without knowing its Apify-like internals, and the main Ad Radar system remains the only owner of durable product truth.

---

## S10 — Support the production-data rehearsal (main M11)

1. Keep the accepted image/config unchanged except approved environment secrets and endpoint bindings.
2. Restore a verified scraper PostgreSQL plus unacknowledged dataset/artifact metadata-and-bytes backup into isolation; rehearse additive locked migrations and an isolated restore.
3. Flush/rebuild disposable Redis solely from PostgreSQL `dispatch_outbox`/authoritative state and prove no lease/fence/idempotency authority was lost.
4. Supply one bounded engine run against the main agent's isolated restored-data stack.
5. Prove atomic budget caps, recipe/coverage/event/dataset/artifact receipts, import acknowledgement and cleanup scheduling.
6. Support timeout/restart/cancellation/stale-fence/interrupted-seal fault injection without changing canonical data or Frank/Hermes code.
7. Run the previous scraper image against the migrated schema; require proven backward compatibility or document/test the exact database+artifact restore rollback path with acceptance paused.
8. Supply immutable engine-run and migration/restore evidence; the main agent owns/signs the overall rehearsal receipt.

### Final exit criterion

The main M11 rehearsal passes with the same candidate intended for production.

---

## S11 — Promote or verify the production scraper engine during M12, before writer activation

This step begins only after main M12a has frozen writers/schedules, applied migrations, deployed the runtime writer-disabled and provisioned its production mTLS identity.

1. Stop new scraper-run acceptance, keep reads/acknowledgements available, and drain/reconcile every `queued`, `running` or `sealing` run to a truthful terminal state. Do not migrate with an active lease/reservation/seal.
2. Record the currently deployed image digest, schema version, capability/profile revisions and safe config fingerprint. For a first install use `previous_state=absent`; rollback disables/removes the gateway binding and restores absence.
3. After drain/reconciliation, briefly pause all mutations including acknowledgements, then create and verify an isolated restore of scraper PostgreSQL plus artifact metadata and every unacknowledged dataset/artifact byte manifest. Retain idempotency tombstones, events, recipes, attempts, fences, budgets, acknowledgements and cleanup receipts.
4. Apply only the S10-rehearsed additive migration under an advisory lock while acceptance remains stopped. Delete/rebuild Redis from PostgreSQL outbox/authoritative rows; never restore Redis authority from a snapshot.
5. Deploy the exact immutable S9/S10-accepted image digest/config, or prove the existing endpoint already runs it. From the production runtime identity, require the accepted capability digest/profile revision and pass `/versions`, health, reconciliation and no-duplicate tests.
6. Prove the previous image remains schema-compatible, or rehearse the documented PostgreSQL+artifact restore rollback. Then roll forward to the accepted candidate; acceptance stays stopped and main writers/schedules stay paused throughout.
7. Return a signed gate receipt containing drained-run counts, old/new schema/image/config fingerprints, backup/restore checksums, Redis rebuild result, capability/profile revisions and rollback/roll-forward evidence—never secrets.
8. Re-enable scraper acceptance only when main M12b is ready to run its canary; scheduled acquisition remains paused until main enables it.

### Exit criterion

Main M12b receives a verified production promotion and rollback receipt before it enables the runtime writer or any schedule.

## Anti-patterns

- Direct scraper calls from Frank browser/backend.
- Giving scraper DB/release-storage credentials.
- Exposing arbitrary URL fetch, browser/debug or actor-admin endpoints through the Ad Radar gateway.
- Returning raw provider payloads inline with normal items/events.
- Claiming classification, QA, approval or release status.
- Mutable datasets after terminal sealing.
- Changing an idempotency key’s meaning.
- Marking partial pagination/provider failure as clean zero results.
- Artifact URLs on arbitrary origins or without scope/expiry.
- Infinite/unbounded waits, pages, bytes, browser workers or retries.
- Contract copies that drift from the published artifact.

## Plan mutation protocol

Record any proposed change with date, contract version, reason, compatibility impact and main-plan dependency. Additive optional response fields may be proposed for a v1 minor version. Required-field/semantic/status/security changes require `/v2`. Do not deploy a private fork of v1 semantics.

## Progress ledger

| Step | Status | Commit/receipt | Notes |
| --- | --- | --- | --- |
| S-1 Feasibility spike | ready; parallel with main M0 | | |
| S0 Contract/scaffold | blocked on main M1/S-1 | | |
| S1 Single-worker vertical slice | not started | | |
| S2 Auth/durable ledger | not started | | |
| S3 Queues/fencing/budgets/affinity | not started | | |
| S4 Resolution | not started | | |
| S5 Capture/media | not started | | |
| S6 Atomic sealing/artifacts | not started | | |
| S7 Gates | not started | | |
| S8 Private candidate | not started | | |
| S9 Joint acceptance (main M10) | blocked on main M9 | | |
| S10 Rehearsal support (main M11) | blocked on S9/main M10 | | |
| S11 Production promotion (during M12 before writer) | blocked on main M12a | | |

## Plan deviations

- 2026-09-03: pre-freeze amendment added S-1/P0 feasibility, S1 single-worker proof, private PostgreSQL/Redis durability, request recipes, coverage, fencing, endpoint affinity, session media and atomic budgets. Existing S1–S10 gates were renumbered S2–S11; no implementation receipt existed, so no completed work was invalidated.
