# AdStudio Baseline Evidence

This evidence is read-only. It records the starting state for
`ADSTUDIO-COMPLETION-PLAN.md`; it does not authorize renderer deletion or any
production mutation.

## Source state

- source commit: `beb75478d5838263ed9be60b4de9b9a1d950bd9b`
- source branch: `origin/main`
- capture time: `2026-07-13T04:43:53.344032+00:00`
- Supabase project: Blockwise, healthy, `ap-southeast-2`

## Production creative inventory

These are timestamped pre-fence baseline values. They are not the final legacy
manifest and cannot prove that production remains unchanged after capture.

The classification used here recognizes a clone only when `canvas_json.objects`
contains exactly one object whose `objectId` is `template_clone_image`. This is
baseline evidence, not the final explicit render-kind contract.

| Measure | Value |
| --- | ---: |
| Creative rows | 427 |
| Campaigns represented | 59 |
| Workspaces represented | 3 |
| Clone rows | 19 |
| Non-clone rows | 408 |
| Pending non-clone rows | 408 |
| `legacy_snapshot` status rows | 0 |
| Multi-object non-clones | 408 |
| Single-object non-clones | 0 |
| Zero-object non-clones | 0 |
| Legacy snapshot storage objects | 0 |
| Legacy snapshot storage bytes | 0 |

Identity/change-detection digests:

- legacy ID plus canvas digest: `3f3593b83e2821bba84711ee68a20441`
- clone ID plus canvas digest: `8753ced3779e73cd5e8ed3c2cddadd2a`

The final snapshot gate must produce and verify an exact secured per-creative
manifest with workspace, source hash/version, artifact hash, MIME type,
dimensions, and byte count. Aggregate counts or these digests are not sufficient
for deletion.

Query provenance:

- read-only service-role SQL against linked Supabase project
  `uwwbvdloschaccycjozr`
- source table `public.adstudio_creatives`; snapshot-object check against
  `storage.objects`
- clone predicate: exactly one `canvas_json.objects` entry whose `objectId` is
  `template_clone_image`
- aggregate query grouped by `workspace_id`, counted distinct campaign IDs,
  classified every creative, and hashed sorted creative-ID plus canvas values

The corrected reproducible inventory tool writes the exact manifest to ignored
local evidence path `artifacts/adstudio/evidence/legacy-manifest.json`. The
manifest itself is not committed because it contains production row identities.

## Secured Gate 0 exact manifest

The read-only tool completed two exact production passes without drift. It used
an explicit `workspace_id` predicate on every AdStudio graph query, keyset
pagination, strict relationship checks, and, for fully resolved rows, a full
render-input hash covering the canonical canvas, format, dimensions, Brand Pack
typography, renderer source, and every renderer-consumed asset byte. No
production row or storage object was changed.

- manifest schema: `adstudio-legacy-inventory/v1`
- query version: `workspace-keyset-v1`
- source commit: `0fb0228ed046be6cfc1cc75d83cbb3d82ece488a`
- capture window: `2026-07-13T07:10:16.329Z` to
  `2026-07-13T07:11:50.807Z`
- tool source SHA-256:
  `4f385816a0baee0e69d8e75e0625bc5a7d3859bb918bba79d474d181b7b9a68b`
- renderer source SHA-256:
  `f61c0d4a81f20bf2ac848da723c551afadf1dc98ae13ae5e64d04a7fc86f7dd3`
- logical manifest SHA-256:
  `0221d10af9eeba54cf9e333fa29ec9549a1d49cd47f7b88643b38e1513a6c912`
- secured written-file SHA-256:
  `1f9904f20728253b6c8df5ab8c2d6fada8a457a8c27e242719e85399cbdb4d11`
- first/second exact-pass SHA-256:
  `b5baf9e447e69d1f85fa946ade00eb07a5812dd4d1f65466aeae9c529ddefdb0`
- workspace-set SHA-256:
  `2e3f9a8f8b6a09e2509b0a823cf81d1976b489c6768172dc0cdf883b5e45dddb`
- evidence location: ignored, repository-confined, atomic mode-`0600` file at
  `artifacts/adstudio/evidence/legacy-manifest.json`
- fence state: preliminary pre-fence inventory; this is not the final Gate 3
  post-fence snapshot identity set

| Measure | Exact value |
| --- | ---: |
| Enumerated workspaces | 6 |
| Creative rows | 427 |
| Flat clones | 19 |
| Structurally classified legacy composites | 404 |
| Unknown/malformed rows | 4 |
| Fully resolved eligible legacy rows | 363 |
| Unresolved rows | 45 |
| Existing legacy snapshots | 0 |

Workspace labels below are local evidence labels, not customer names. Their
workspace IDs are represented only by SHA-256.

| Label | Workspace-ID SHA-256 | Total | Clone | Legacy | Unknown | Unresolved | Eligible legacy | Creative-set SHA-256 | Render-input-set SHA-256 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| workspace-01 | `11e594f481958c10e3015d0bf0447a22f068a8a647f475df15ce2c7ab4b8f3f1` | 371 | 15 | 356 | 0 | 41 | 315 | `5bb0f4c07db52dc9aafdcc6ecc912e4f90c76cc077b30601059c2b58fefb2ab6` | `38f57cbc98f4edd9f5967b09e0eeeae3f66dceba1de3700ccf4a2874957d464a` |
| workspace-02 | `e79acd97ac88086665d85a762f43d533a45195b6bac5961a993e6ed362471439` | 0 | 0 | 0 | 0 | 0 | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| workspace-03 | `ca5e64ddc6286a6600275c2601783575215958a313b5592ee1ee1de1d6310393` | 13 | 4 | 9 | 0 | 0 | 9 | `61187da190c5aef9841f40e4f643c3a3551831b174dd12a3966dbc377205f80d` | `d6d5e906027c19aea6eae76b145956fd04439cc01063366a0020884ec53d24ad` |
| workspace-04 | `973504150df8847ba7d197cdf1a629729277d72c66587c649ff87049a2fcc02e` | 43 | 0 | 39 | 4 | 4 | 39 | `ed2521594ecd5dc5fa3b5561920dbce37c590af181e2102a6b8e2c52483a3550` | `2a2a55752b474973b710605c90150e7498cca9336734cde90c8889b47aa58c78` |
| workspace-05 | `c0a81ca798074eff6ac8db84d9dd7bd40df912bf1a5018f97e64e4e8a1a3406c` | 0 | 0 | 0 | 0 | 0 | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| workspace-06 | `52c263b20c0f5ce84cfd65d5d0585837e7b0df1d16d0ee934e1e54ff3bba4764` | 0 | 0 | 0 | 0 | 0 | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |

The manifest records 41 `asset_resolution_failed` issues and four
`canvas_shape_invalid` issues. A same-source, read-only resolver diagnostic
classified all 41 asset failures as DNS-not-found responses; the four unknown
rows are all `malformed_object_shape`. The exact affected identities remain
only in the secured manifest. Snapshot execution and renderer deletion remain
blocked until those rows are repaired or explicitly quarantined under the
frozen migration contract; this evidence does not lower that gate.

## Template portfolio

`node scripts/verify/adstudio-templates.mjs` passes with one active template:

- active templates: 1
- distinct `primary_intent`: 1
- intent mix: `listing=1`
- semantic-diversity enforcement is dormant until the gallery reaches 12

The launch gate remains 12 unique source hashes, at least six intents, and no
intent above three templates.

## Active production model profiles

| Profile | Provider | Model | Recorded unit-price field |
| --- | --- | --- | ---: |
| `image_draft` | OpenRouter | `google/gemini-2.5-flash-image` | $0.039 |
| `image_final` | OpenRouter | `google/gemini-2.5-flash-image` | $0.039 |
| `structured_json` | OpenRouter | `openai/gpt-4.1-mini` | $0.000 |
| `vision_classification` | OpenRouter | `openai/gpt-4.1-mini` | $0.000 |

These are runtime overrides, not committed defaults. Every paid batch must
resolve and record the then-active profile and fallback chain.
The `$0.000` structured/vision values are unreconciled telemetry fields, not
evidence that those calls are free.

At capture, OpenRouter's public model catalog expressed
`google/gemini-2.5-flash-image` pricing in token-denominated fields rather than
as a fixed `$0.039` output-image charge. The persisted `$0.039` value is therefore
a configured fallback estimate, not provider billing truth. Provider-reported
`usage.cost` must be authoritative, with the exact runtime price and unit stored
only as the fallback snapshot used for reconciliation. Source:
<https://openrouter.ai/api/v1/models> and OpenRouter's
[image-generation response contract](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

## Provider cost telemetry finding

Recent clone image runs are recorded with zero estimated cost even when the
active profile has a non-zero image unit price. Recent clone-QA runs commonly
record about $0.03 per completed review. The original read did not retain an
exact sample window or run-ID set, so this is a preliminary defect signal rather
than Gate 0 acceptance evidence. Cost caps cannot be trusted until image, copy,
vision, QA, retry, and failed-but-billed cascade costs are recorded and
reconciled against a committed query window and run-ID digest.

This is a Gate 0 blocker for paid matrix execution, not for unpaid implementation
work.

## Workflow and access readiness

- GitHub CLI is authenticated to the repository owner account.
- `Hard Reset Verification` is active and green on the source commit at
  <https://github.com/stevenshelley58-afk/blockwise/actions/runs/29196909095>.
- `Hard Reset Verification` run `29196909095` succeeded on the exact source SHA,
  including its `Deploy trigger.dev tasks` job. Any subsequently changed task
  must still be deployed and registration-confirmed again.
- That job registered Trigger.dev production version `20260712.1` with nine
  detected tasks; deployment ID `yhy0q8l7` is retained in the GitHub job log.
  The source task IDs are `adstudio.generate.template`,
  `research.ad-radar.accuracy.weekly`, `sync-provider-reports`,
  `publish.meta.execute`, `publish.meta.mutate`, `sync.meta.leads`,
  `deliver.lead`, `sync.meta.leads.scheduled`, and
  `check.meta.token-health.scheduled`.
- `AdStudio E2E (Vercel Preview)` is active and the required password secret is
  present. Its latest historical automatic runs failed or skipped; the workflow
  is now deliberate/manual and must be dispatched against the matching Preview
  commit.
- Supabase CLI is authenticated and linked to the Blockwise project.
- Vercel CLI is authenticated and linked to project
  `prj_8gJyKjHN4miNOWK7ReA4vKDXxc4B`. The plan merge is deployed from committed
  source `94a1500` as Ready production deployment
  `dpl_7uHHyVrB3TqxwDD7VuLni6vcNCxE`; its build log identifies branch `main`
  and commit `94a1500`. The production `/api/health` route returned HTTP 200
  with `status=ready` after deployment.
- The corresponding Ready plan Preview is deployment
  `dpl_E6Y99PNANJ32eBFkyK2GWNT4KfpV`. GitHub reports the matching Vercel check
  green on PR 171.
- The Supabase server credential handling fix merged as commit
  `f4d86adc3c2610fdb4d6ac5cae1438fe867357c5`. Its current Vercel production
  deployment is Ready as `dpl_eaLbJVDGwR5dsBYrcnFmPXeVkpei`, and
  `https://blockwise.sale/api/health` reports `status=ready`.
- Trigger.dev production version `20260713.5` registered the nine tasks from
  that committed source. Hermes runs the same commit on the VPS and its local
  health endpoint reports `status=ok`.
- Following a credential-handling incident, the affected current secret was
  replaced and deleted. Vercel, Trigger.dev, GitHub Actions, and Hermes now use
  the replacement secret; the public app uses the publishable key. Supabase
  legacy API keys are disabled, and Hermes no longer retains the legacy JWT
  values. No credential value or prefix is recorded here.
- Vercel lists the required Supabase, Trigger.dev, OpenRouter, and OpenAI secret
  names in their applicable Preview/Production environments. GitHub lists the
  AdStudio E2E password and Trigger.dev deployment secret names. No secret value
  was read or recorded.

Provider-run sample IDs/window remain an open Gate 0 evidence item. The cost
accounting change and the integrated Gate 0 branch must still receive matching
Preview and Production evidence before paid execution; the documentation and
credential deployments above cannot satisfy those later behavior gates.

## Safety conclusion

No production row or storage object was changed. Renderer deletion is blocked:
all 408 non-clone rows remain unsnapshotted, 45 rows are unresolved or unknown,
the application has no proven snapshot reader/export path, and legacy write
paths are not yet fenced.
