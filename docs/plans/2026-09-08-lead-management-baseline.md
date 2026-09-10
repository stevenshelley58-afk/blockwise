# Lead management baseline (LM-01 + UX-01), 8 September 2026

Status: **baseline recorded, implementation not started.** This is dated
evidence gathered on 8 September 2026, not a deployment or readiness claim.
It records LM-01 and the Frank portion of UX-01 from the current lead/email
build plan.

## 1. Headline finding: Frappe is absent, not diverged

The plan makes Frappe CRM the single owner of working lead, task and outcome
state. **Frappe is not installed anywhere on this VPS.**

Evidence:

- `docker ps -a` (all containers, not just running): no Frappe, ERPNext or CRM
  container.
- `find / -maxdepth 4 -iname "*frappe*"` (excluding /proc, /sys, node_modules):
  no match. No `/opt/bench`, no `frappe-bench`, no site directory.
- `grep -rin "frappe" /projects/blockwise/src /projects/frank/apps`: no match.
  There is no partially built adapter to revive.

The plan noted Frappe CRM 1.83.0 / Framework 15.120.0 as observed earlier and
flagged availability as unverified. It is now verified as **absent**. No
pinned version exists to reconcile against, and there is no deployment to
restore. Standing up Frappe is new managed infrastructure, not a repair.

Consequence: LM-02, LM-03, LM-04, LM-05, LM-07 and LM-08 all depend on Frappe
as the canonical owner and are **blocked**. LM-01 records this as missing
rather than substituting a second CRM, per the plan instruction.

## 2. Serving revision and canonical checkout diverge

| Role | Revision | Notes |
| --- | --- | --- |
| Serving (live) | `de606ac66fe917ce9c0dd7ba6a86ef3a37ab8ecd` | `fix(adstudio): decode storage object keys when discarding revisions`, 8 Sep 10:07 UTC. Reported by `https://blockwise.sale/api/health`. Image `blockwise-app:de606ac6...` |
| Canonical checkout | `e39e5a4f43be2ef3431e31970f09d7e22bfb9b07` | Branch `release/remove-property-check-nav-v2`, `/projects/blockwise` |

`git merge-base --is-ancestor de606ac6 e39e5a4f` is **false**. The live
revision is not on the canonical branch. This matches the release guide
warning that canonical and serving diverge deliberately.

Canonical working tree is dirty: `AGENTS.md` and `DESIGN.md` modified,
`adstudio/` untracked. A correct task checkout must be chosen before edits.

## 3. Capture store and lead data

Lead and capture tables exist in the `blockwise` database (not `postgres`):

`public.leads`, `public.meta_leads`, `public.lead_delivery_attempts`,
`public.lead_events`, `public.lead_quality_labels`,
`public.lead_source_attribution`, `public.lead_dedupe_records`,
`public.lead_imports`, `public.lead_export_audits`,
`public.google_lead_forms`, `public.lead_magnets`, `public.report_email_leads`.

Exact row counts on 8 September 2026:

| Table | Rows |
| --- | --- |
| `public.leads` | 0 |
| `public.meta_leads` | 0 |
| `public.lead_delivery_attempts` | 0 |
| `public.lead_events` | 0 |
| `public.email_outbox` | 4 |
| `public.workspaces` | 4 |
| `public.workspace_members` | 4 |

**There is no historical lead data.** The plan LM-04 backfill mode and test
T16 (historical backfill, zero automatic tasks or alerts) have no production
rows to migrate. This removes the largest migration risk from the plan, and
also means no real customer data is at stake in the capture store today.

Capture entry points: `src/app/api/integrations/meta/publish-plans/[id]/leads/sync/route.ts`,
`src/lib/providers/meta-leads-worker.ts`, `src/lib/providers/scheduled-maintenance.ts`,
`src/lib/meta/data-deletion.ts`. Delivery is queued through
`src/lib/providers/lead-delivery-queue.ts` (`deliver.lead`, 3 attempts).

## 4. Email drain and outbound state

`blockwise-email-outbox-drain.timer` is **active**, roughly every minute,
running `blockwise-email-outbox-drain` as user `hermes` with
`EnvironmentFile=/srv/blockwise/product/.env`. Recent runs report
`claimed:0 sent:0 suppressed:0 failed:0`.

The outbox holds 4 rows, all `message_type = launch_canary` (3 `sent`,
1 `suppressed`). **No lead or customer email is currently being sent.**

`src/lib/email/lead-lifecycle.ts` contains digest and
`scheduleFollowUpEmail` helpers. `scheduleFollowUpEmail` appears exactly once
in `src/` (its own definition) and has no caller, so the plan LM-09 audit
should confirm it is dead or gated rather than assume it is live.

## 5. Membership and permissions

The existing identity system already provides scoped access:
`workspace_members`, `enabled_roles`, `applicable_roles`,
`administrable_role_authorizations`, `cross_workspace_access_grants`,
`workspace_invitations`. LM-02 should map capabilities onto these rather than
introduce new authority.

## 6. Frank email and lead screens (UX-01)

The Frank "Inbox" under `apps/window` is a **mock**, not a connected inbox.

| Surface | Reality |
| --- | --- |
| `web/js/operations-tools.js` Inbox widget | Hardcoded `OPERATIONS_TOOLS` literal, no `fetch`, self-labelled "Preview data" / "Preview only". Credits "Chatwoot + Stalwart", neither configured. Fake unread counts |
| `/api/email-tools` | Working API, live. Reports connector status only: `mailflare` `configured` (role `human_inbox`); `stalwart`, `resend`, `mautic`, `resend.mcp_status` unconfigured |
| `/api/support/conversations` | Working route, **empty**. `/srv/frank/data/window/support-conversations.json` does not exist. No UI consumer |
| `tools/mail/` | Manifest and validator only, no screen. Reports `status: unavailable` |
| `/api/ad-db/prospects` | Working, **real data**. The only genuine lead surface in Frank |

There is **no conversation store** in Frank at all. The only configured
conversation provider is **Mailflare** (`MAILFLARE_BASE_URL`,
`MAILFLARE_CONNECTOR_STATUS` set in `/srv/frank/secrets/window.env`).
Chatwoot, Stalwart, Resend, Mautic, IMAP and SMTP are all absent from the
running container.

Frank also shows deploy/source divergence:
`RUNTIME_FRANK_REVISION=238f5c9` against worktree HEAD `d5cb6b3`.

Ops lead surfaces (`/api/ops/enquiries/unassigned` and friends) are working
APIs over an **empty** store (`status: setup_needed`), and the ops action
endpoints are disabled because `FRANK_OPS_CONTROL_URL`,
`FRANK_OPS_OPERATOR_ROLE` and `FRANK_OPS_OPERATOR_AAL` are empty.

Retain: the `_connector_status` truthful-status pattern and explicit
"Preview data" labelling on mocks; keyboard handling in `ad-db.js` and
`ops.js` (arrow/Home/End navigation, Escape). There is no command palette.

## 7. Concurrent work

Many Blockwise worktrees have files modified in the last 48 hours, including
`blockwise-email-options-20260907`, `blockwise-email-delivery-20260907`,
`blockwise-analytics-20260907` and `blockwise-gallery-build-20260908`.
Email-adjacent work is in flight. The lead/CRM work must not collide with it.

## 8. What is unblocked

- UX-02 (define the two experiences) and UX-03 (nine prototypes with fake
  data, no live provider writes) need no Frappe and can proceed now.
- LM-06 (external mailto/tel draft helper) and LM-09 (audit and reporting
  cleanup) are largely independent of Frappe.
- LM-05 customer screens depend on LM-03/LM-04 and therefore on Frappe.

## 9. Decisions required before implementation

1. **Install Frappe, or choose a different canonical owner.** One Frappe site
   per agency on shared infrastructure is new managed infrastructure with
   real memory, backup, DNS and operational cost. It needs an explicit go
   ahead and a resource decision.
2. **Which checkout is the task base** for this work given the
   live `de606ac6` / canonical `e39e5a4f` divergence, and how the AdStudio
   work on live gets reconciled.
3. **Whether the internal Frank inbox uses Mailflare** as the authorized
   conversation provider, or whether that workstream stays on hold.
