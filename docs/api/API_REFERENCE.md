# API reference

HTTP route handlers under `src/app/api/**/route.ts`. All authenticated routes
resolve workspace membership server-side; mutations should enforce a capability
(`requireCapability`) and operator-only routes use `requireOperator`
(sources `profiles.is_operator`). See `../architecture/capability-model.md`.

> Auth column legend: **public** = no auth; **member** = any workspace member;
> **author** = `create_ads`/`edit_ads`; **approver** = `approve_ads`/`publish_ads`;
> **operator** = `is_operator`. Migrating routes from coarse surface checks to
> fine-grained capabilities is in progress — treat this column as the intended
> gate.

## Health & misc

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | public | Liveness + configuration readiness |

## AdStudio — brand kits

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/adstudio/brand-kits` | author | List / create brand kits |
| `/api/adstudio/brand-kits/extract` | author | Extract brand kit from a website |
| `/api/adstudio/brand-kits/[id]` | author | Get / update / delete a brand kit |
| `/api/adstudio/brand-kits/[id]/approve` | approver | Approve a brand kit version |
| `/api/adstudio/brand-kits/[id]/assets` | author | Manage brand assets |
| `/api/adstudio/brand-kits/[id]/rescan` | author | Re-scan brand source |

## AdStudio — campaigns, creatives, variants

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/adstudio/campaigns` | author | List / create campaigns |
| `/api/adstudio/campaigns/[id]` | author | Get / update / delete a campaign |
| `/api/adstudio/campaigns/[id]/generate` | author | Generate a campaign pack |
| `/api/adstudio/campaigns/[id]/regenerate` | author | Regenerate campaign content |
| `/api/adstudio/campaigns/[id]/duplicate` | author | Duplicate a campaign |
| `/api/adstudio/campaigns/[id]/variants` | author | List / create variants |
| `/api/adstudio/variants/[id]` | author | Get / update a variant |
| `/api/adstudio/variants/[id]/approve` | approver | Approve a variant |
| `/api/adstudio/variants/[id]/score` | author | Score a variant |
| `/api/adstudio/creatives` | author | List / create creatives |
| `/api/adstudio/creatives/[id]` | author | Get / update a creative |
| `/api/adstudio/creatives/[id]/render` | author | Render a creative |
| `/api/adstudio/creatives/[id]/regenerate-background` | author | Regenerate creative background |
| `/api/adstudio/creatives/[id]/export` | author | Export a creative |
| `/api/adstudio/generate-image` | author | Generate an image asset |

## AdStudio — compliance, export, jobs

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/adstudio/compliance/check` | author | Run compliance checks |
| `/api/adstudio/compliance/fix` | author | Apply suggested compliance fixes |
| `/api/adstudio/compliance/reports/[id]` | member | Get a compliance report |
| `/api/adstudio/export-packages` | author | List / create export packages |
| `/api/adstudio/export-packages/[id]` | author | Get an export package |
| `/api/adstudio/export-packages/[id]/download` | author | Download package manifest |
| `/api/adstudio/export-packages/[id]/publish` | **approver** | Approve + enqueue Meta publish (gated by `BLOCKWISE_ENABLE_PROVIDER_WRITES`) |
| `/api/adstudio/publish-readiness` | member | Publish-readiness checks |
| `/api/adstudio/jobs` | member | AdStudio job status |
| `/api/adstudio/provider-runs` | member | AdStudio provider run history |

## Approvals, campaigns, compliance, leads

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/approvals` | member | List approval requests |
| `/api/approvals/[id]` | **approver** | Approve/reject; approval enqueues provider publish/delivery |
| `/api/campaigns` | member | Campaign listing |
| `/api/compliance` | member | Compliance lookups |
| `/api/leads` | member | Lead ingestion / listing |

## Integrations (OAuth & provider I/O)

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/integrations/meta/connect` | operator/owner | Start Meta OAuth |
| `/api/integrations/meta/callback` | public (OAuth) | Meta OAuth callback + token vault write |
| `/api/integrations/meta/setup` | operator/owner | Configure Meta account |
| `/api/integrations/meta/publish-plans/[id]/mutations` | approver | Queue a Meta plan mutation |
| `/api/integrations/meta/publish-plans/[id]/leads/sync` | member | Sync Meta leads for a plan |
| `/api/integrations/meta/data-deletion` | public (callback) | Meta data-deletion request handler |
| `/api/integrations/google/connect` | operator/owner | Start Google OAuth |
| `/api/integrations/google/callback` | public (OAuth) | Google OAuth callback + token vault write |
| `/api/provider-sync` | operator | Trigger provider data sync |

## Monitor, model, ledger

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/monitor-dashboard` | member | Dashboard data (spend, leads, provider health) |
| `/api/model-profiles` | operator | List model profiles |
| `/api/model-profiles/[key]` | operator | Get / update a model profile |
| `/api/model-profiles/[key]/test` | operator | Test model selection |
| `/api/ai-ledger` | operator | AI spend ledger |
| `/api/agent-runs` | operator | AI Workforce run history (`public.agent_runs`) |

## Operator — Hermes research control (operator-only)

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/operator/research/runs` | operator | Research run history |
| `/api/operator/research/coverage` | operator | Coverage view |
| `/api/operator/research/defects` | operator | Coverage defects |
| `/api/operator/research/policies` | operator | Get / update refresh policies |
| `/api/operator/research/kill-switch` | operator | Pause/resume scheduled scraping (audited) |
| `/api/operator/research/refresh-now` | operator | Force a postcode/page refresh (audited) |
