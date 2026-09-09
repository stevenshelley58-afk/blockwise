# Homepage concept evidence register (Ticket 01)

Date checked: 8 September 2026. This register distinguishes the original
read-only baseline from the observations used for the homepage rework. It does
not record a production release or change billing policy.

## Original baseline, preserved as dated evidence

These observations were made for the earlier homepage-concept task. They are
historical context, not a claim about the current main branch, a current
preview container or a live release.

| Item | Original observation |
|---|---|
| Public concept route | `https://blockwise.sale/homepage-preview/concept` returned HTTP 200. |
| Serving preview revision | `6ea2231796f6da2399e490a1e7443564085747be`. |
| Edit worktree | `/projects/blockwise-homepage-chat-reconciled-20260907`. |
| Worktree branch and HEAD | `codex/workflow-continuity-20260908` at `bd9c2c33969b0399a4d09f7ab5c232298d89ba31`. |
| Preview routing | `scripts/vps/homepage-preview-route.py`, with GET and HEAD only, credentials stripped and noindex response headers. |
| Preview base path | `NEXT_PUBLIC_BASE_PATH` through `withBasePath` and `next.config`. |
| CodeGraph | No `.codegraph` was present in that worktree. |

The original notes about the main product revision, preview container/image,
other worktrees and the old worktree's dirty state are deliberately not carried
forward as current facts. Release identity is recorded separately when a
release actually occurs.

## This task checkout and scope

| Item | Task observation |
|---|---|
| Checkout | `/projects/blockwise-homepage-rework-20260908` |
| Branch | `codex/homepage-rework-20260908` |
| Starting revision | `bd9c2c33969b0399a4d09f7ab5c232298d89ba31` |
| Preserved source | The original checkout remains unchanged. Five related dirty source files were copied into this task checkout for the rework. |
| Commercial policy | No billing, checkout, entitlement or provider-write policy changed. |
| Release state | This is implementation evidence only. No commit, deployment or live acceptance is recorded here. |

## Offer and CTA evidence used for the homepage

| Claim | Evidence | Homepage wording or treatment |
|---|---|---|
| Free allowance size | `FREE_TRIAL_RENDER_LIMIT = 6` and `RENDERS_PER_AD_PACK = 2` in the trial source. | Three Feed + Story ad packs. |
| Free campaign allowance | Current task direction. | One campaign. |
| Card required to start | The billing trigger describes the allowance before Checkout, with no card required. | No card needed to start. |
| Saved work after the allowance | Current task direction. | Saved designs and leads stay available. A paid plan is a customer choice, not an automatic charge. |
| Self-serve price | Billing offer source: `24_900` AUD recurring amount and inclusive tax behaviour. | A$249 per month, until cancelled. |
| Managed price | Billing offer source: `150_000` AUD recurring amount. | From A$1,500 per month, plus Meta ad spend. Scope is agreed in writing before payment. |
| Meta ad spend | Checkout disclosures for paid plans. | Paid separately to Meta. |
| Self-serve allowance | The maintained public pricing page publishes 100 render credits, up to 50 Feed + Story packs each month. | Preserve the published wording without presenting it as a verified technical entitlement. |
| Team and account limits | Maintained pricing page and verified-workspace migration. | Five team members, one brand and one Meta ad account. |

All free-start acquisition CTAs use
`https://blockwise.sale/signup?offer=self-serve` with the shared label
`Start your free trial`. No homepage CTA uses a local mock form or `#trial`.

## Trial timing and public wording

`trialDays: 0` in the billing offer is not a timing contradiction. It describes
a no-card allowance before Checkout rather than the public trial countdown.

The unresolved wording issue is different: the public pricing page says 14 days
start with first Meta delivery, while an earlier migration refers to seven days
from verified email and public wording also describes post-trial access. This
task does not resolve that policy question. The homepage therefore states the
allowance without a duration, start event or expiry promise.

## Presentation and evidence boundaries

- The current design uses manual demos. It does not retain the earlier autoplay
  claim as a current design observation.
- No approved customer proof, results claim, testimonial or proof section was
  supplied, so none is presented.
- Enquiry, lead and follow-up visuals are clearly examples or concepts. They do
  not claim a live end-to-end provider workflow.
- The grouped, collapsed FAQ remains. It explains costs, ownership, support and
  the paid-choice condition without inventing trial timing.
- Provider writes remain outside this homepage work. This register does not
  claim they are enabled or disabled at the time of reading.

## Verified public destinations from the original baseline

The original check found `/pricing`, `/login`, `/signup`, `/privacy`, `/terms`
and `/data-deletion` returning 200. `/contact` returned 404; the verified
contact route was `mailto:hello@blockwise.sale`. The managed setup anchor was
`https://blockwise.sale/#managed-setup`.

These destination checks are retained as dated evidence only and should be
rechecked before any release.
