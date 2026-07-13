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

The corrected reproducible inventory tool will write the exact post-fence
manifest to ignored local evidence path
`artifacts/adstudio/evidence/legacy-manifest.json`. Gate 0 remains incomplete
until that tool includes explicit workspace predicates, per-workspace groupings,
and a full render-input hash for every creative. The manifest itself is not
committed because it contains production row identities; its SHA-256, aggregate
per-workspace counts, query version, source commit, and secured evidence location
will be committed here.

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
- Vercel lists the required Supabase, Trigger.dev, OpenRouter, and OpenAI secret
  names in their applicable Preview/Production environments. GitHub lists the
  AdStudio E2E password and Trigger.dev deployment secret names. No secret value
  was read or recorded.

Per-workspace aggregate rows, the exact secured manifest SHA, and provider-run
sample IDs/window remain open Gate 0 evidence items. Behavior-changing Gate 0
code must still receive its own matching Preview and Production deployment IDs;
the documentation deployment above cannot satisfy that later evidence.

## Safety conclusion

No production row or storage object was changed. Renderer deletion is blocked:
all 408 legacy creatives remain unsnapshotted, the application has no proven
snapshot reader/export path, and legacy write paths are not yet fenced.
