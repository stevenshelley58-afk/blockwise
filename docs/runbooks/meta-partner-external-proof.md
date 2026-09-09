# Meta Partner External Proof Gate

- Standing decision: **NO_GO** (2026-08-31) — see the decision record below.
- Proof state: **UNPROVEN**; the previous receipt is a stop receipt and expired
  at issuance.
- Step 0 tooling: **implemented** — `scripts/meta/verify-partner-external.mjs`
  (+ `src/lib/providers/meta-partner-proof.ts`) can now execute the controlled
  proof protocol described here. The live run remains human-gated.
- Machine-readable receipt (previous stop receipt):
  [`../evidence/meta-partner-proof/2026-08-31/receipt.json`](../evidence/meta-partner-proof/2026-08-31/receipt.json)
- Applies to: the automated Meta Business Portfolio partner-assisted customer
  connection path
- Does not block: customer OAuth, Meta App Review, creative export, or
  explicitly manual/operator publishing

## Purpose and go/no-go authority

The partner flow (Flow B in `src/lib/providers/meta-partner.ts`) assumes a
customer can share their ad account and Page with Blockwise's Business
Portfolio and that one Blockwise system-user token can then act on them. This
has never been proven against a **genuinely external** business: Meta's
Marketing API Access Tier and per-permission access levels are app controls
that partner asset sharing cannot promote (see "Why partner sharing does not
remove the app gate" below).

Step 0 is the go/no-go gate for the whole partner program. The tooling executes
the proof; the **live run is executed by humans**:

- a named **proof_executor** runs the script, and
- an independent **proof_reviewer** (a different person) reviews the emitted
  receipt before any go decision is recorded.

Only the proof_reviewer's sign-off on a committed, current receipt authorizes a
"go". Nobody may enable partner starts on the strength of an unreviewed or
expired receipt, and the standing NO_GO decision remains in force until such a
receipt exists.

## Prerequisites

### External Business Portfolio checklist (the volunteer customer)

- [ ] The Business Portfolio is **not Blockwise-owned** and contains **no
      Blockwise app-role users** (no app admins, developers, or testers among
      its people).
- [ ] A **disposable ad account** exists (no live spend, nothing worth
      keeping; everything the proof creates is deleted afterwards).
- [ ] A **disposable Page** exists that can be used as the ad identity.
- [ ] Optional: an Instagram business account linked to that Page. **Do NOT
      share Instagram as a separate asset on the first pass** — the
      Instagram-discovery probe decides whether a separate share is required.
- [ ] No payment method needed; every object is created `PAUSED` and cleaned up.

### Blockwise side

- [ ] The app is published and the required App Review work is complete
      (Marketing API Access Tier `Full Access` shown in the App Dashboard;
      per-permission Advanced Access where Meta requires it for managing an
      unrelated business).
- [ ] App mode and Marketing API Access Tier **recorded** (passed to the script
      via `--app-mode` and `--access-tier`).
- [ ] `META_BUSINESS_ID` configured in the controlled runtime (the script
      aborts if it cannot verify the probed ad account is not Blockwise-owned).
- [ ] System user created with the permission set:
      `ads_read, ads_management, business_management, leads_retrieval,
      pages_manage_ads, pages_show_list, pages_read_engagement`; the
      system-user token lives in the approved private provider-token vault —
      never in repository files or command history.
- [ ] Leads Access Manager state recorded: the app/CRM and the executing system
      user have the required Page lead access (a Page or form read does not
      prove lead retrieval access).
- [ ] `META_APP_ID` + `META_APP_SECRET` optionally configured — they enable the
      `/debug_token` identity probe; without them that probe skips cleanly.
- [ ] A named executor and a different independent human reviewer are
      available.

## Exact share steps (performed from the external portfolio)

1. **Ad account share** — Business settings → Partners → add Blockwise's
   Business ID, then share the disposable ad account with the tasks:
   - `Manage campaigns (ads)` (ads_management), and
   - `View performance` (ads_read).
2. **Page share** — share the disposable Page with the minimum task set needed
   for ad identity + Page token: `Manage` (pages_manage_ads) plus task access
   that allows token resolution (pages_show_list, pages_read_engagement).
3. **Instagram** — explicitly **do not share Instagram separately** on the
   first pass. The script's Instagram-discovery probe records whether the
   Page-linked `instagram_business_account` is reachable without a separate
   asset share. Note: a discovered Page-linked Instagram account proves only a
   relationship; ad-identity proof requires the paused creative/ad using that
   Instagram actor plus a successful ownership/readback check (the full path
   performs exactly that).
4. Wait for the share to propagate (usually minutes), then run the script.

## How to run the script

Always rehearse with `--dry-run` first (offline, fixture-driven, CI-safe — no
network, no token prompt):

```bash
node scripts/meta/verify-partner-external.mjs --dry-run --full-path \
  --proof-executor operator-a --proof-reviewer operator-b \
  --access-tier full_access --app-mode live \
  --permissions ads_read,ads_management,business_management,leads_retrieval,pages_manage_ads,pages_show_list,pages_read_engagement \
  --output-dir /tmp/proof-dry-run
```

Live run (token via STDIN only — paste, then Ctrl+D):

```bash
node scripts/meta/verify-partner-external.mjs \
  --external-business-id <external business id> \
  --ad-account-id act_<external ad account id> \
  --page-id <external page id> \
  --access-tier <tier> --app-mode <mode> \
  --permissions ads_read,ads_management,business_management,leads_retrieval,pages_manage_ads,pages_show_list,pages_read_engagement \
  --proof-executor <name> --proof-reviewer <name> \
  --full-path
```

Token handling rules enforced by the tooling:

- The system-user token is read from **STDIN only**; argv/env/file token flags
  are refused outright, and empty or `PLACEHOLDER` tokens are rejected.
- The token is never printed, logged, or embedded. All transcript output is
  redacted; every Graph call uses an `Authorization: Bearer` header with **no
  `access_token` query parameter anywhere** (repository adapters are wrapped by
  `createBearerEnforcingFetch`, paging URLs included).
- The receipt contains only SHA-256-hashed Meta object IDs — never raw IDs,
  names, tokens, or lead data.

What the run does:

- **Read probes** (each prints a PASS/FAIL/SKIP line plus redacted JSON):
  token identity (`/me` + `debug_token` when an app token is available),
  external ad-account read with the external-business enforcement, Page token
  resolution, Page-linked Instagram discovery, campaign listing, insights.
- **`--full-path`**: builds the same `OUTCOME_LEADS` + `HOUSING` publish plan
  Ad Studio builds (`buildPausedMetaPublishPlan`) and executes it through the
  repo executor (`createMetaExecutionAdapter("marketing_api")`) against the
  external ad account with the shared Page as ad identity (plus the Page-linked
  Instagram identity only if discovery passed). Every delivery-bearing object
  is created `PAUSED` and must read back `PAUSED` and ownership-verified or the
  run fails hard. One synthetic test lead is created via
  `POST /{form-id}/test_leads`, retrieved through the repo lead adapter
  (`fetchMetaLeadFormLeads`), deleted on Meta, and its local data dropped.
  Reporting is read for the created objects.
- **Cleanup** always runs (including on failure): delete the test lead, then
  ad → creative → ad set → campaign → form, each with a bounded timeout and a
  per-object receipt. Deletion means Meta's terminal operation for the object
  type (the form falls back to an archive attempt); the script exits non-zero
  if any object remains. Cleanup is terminal-state, not physical-erasure,
  proof.

## Go criteria

All of the following must hold on a single live run:

- Every read probe PASSes (token identity may SKIP cleanly only when no app
  token is configured).
- The Instagram-discovery probe has an explicit recorded outcome (a FAIL here
  is a product decision input — "customers must share Instagram separately" —
  not an automatic no-go, provided the full path ran without an Instagram
  identity).
- With `--full-path`: the disposable campaign/ad sets/creatives/ads/Instant
  Form are created exactly `PAUSED`, read back with ownership verified, the
  synthetic test lead is retrievable through the repo lead adapter and deleted,
  reporting reads succeed, and **every created object reaches its terminal
  state** (cleanup receipts all `deleted`/`archived`).
- The receipt is written, committed at
  `docs/evidence/meta-partner-proof/<date>/receipt.json`, and independently
  reviewed (reviewer ≠ executor).

## STOP criteria (any one is a no-go)

- Access-tier or App Review rejection of any call in the path.
- A missing permission or capability error for any product-path operation.
- The shared Page is unusable as an ad identity.
- Leads are unretrievable after the synthetic test-lead submission.
- Cleanup could not delete/archive every created object (exit code 2).
- The receipt was not independently reviewed.
- The only working path requires a Blockwise app-role user on the external
  portfolio (that is not the self-serve partner flow).
- Any created object can deliver, or the delivery-status contract above was
  violated.

## Failure interpretation

Graph-error triage:

| Observed Graph error | Permission missing | Asset not shared | Access tier missing | Invalid token |
| --- | --- | --- | --- | --- |
| `(200) Permissions error` / `(#3) App must be on whitelist` | likely (check `--permissions` against the failing call) | possible — confirm the exact asset was shared | possible if the tier lacks the capability | unlikely |
| `(#10) Application does not have permission for this action` | **yes** — grant the named scope and re-run | possible | possible (Full Access capability) | no |
| `(#100) Invalid parameter` / object not found | no | **likely** — the share has not landed or the wrong ID was attested | no | no |
| `(#190) Error validating access token` / `Session has expired` | no | no | no | **yes** — re-issue the system-user token |
| `(#200) Requires business management` / asset not visible in `/me/adaccounts` | possible (`business_management`) | **likely** — re-do the share with the exact tasks | no | no |
| `(#294)` / "on behalf of another business" / access-level messages | no | possible | **likely — upper (Full) Marketing API Access Tier required** | no |

Classification and required action:

| Observation | Classification | Required action |
| --- | --- | --- |
| App tier is Limited Access | `marketing_api_full_access_missing` | Stop; continue Meta approval work |
| Required permission is Standard when Advanced is required | `permission_advanced_access_missing` | Stop; complete permission review |
| Business ID or vault token absent | `partner_credentials_missing` | Stop; configure only after approval |
| Account/Page missing after share | `asset_not_shared` | Correct partner asset assignment; do not infer app-tier failure |
| Page-linked Instagram identity discovered but rejected on paused ad | `instagram_ad_identity_unproven` | Do not offer Instagram selection |
| Test lead POST succeeds but GET fails | `lead_retrieval_unproven` | Verify Leads Access Manager and permission state; stop |
| No independent reviewer | `independent_review_missing` | Stop; receipt cannot pass |
| Any object can deliver or cleanup is incomplete | `cleanup_or_delivery_safety_failed` | Stop, contain manually, record sanitized failure |

## Delivery-status and lead-test contract (binding for the tooling)

- Campaign, ad set, and ad are delivery-bearing objects: create each with
  `status=PAUSED`, then read back and require the effective status to remain
  non-delivering.
- An Instant Form and an ad creative do not accept the delivery status
  `PAUSED`; never send it for those object types.
- Create the form and creative only inside the bounded proof window, after the
  paused campaign hierarchy exists; attach them only to a paused ad.
- Lead test sequence: `POST /{form-id}/test_leads` → retrieve through the
  repository lead adapter → `DELETE /{lead-id}`. Only synthetic values are
  allowed; raw lead/object IDs and field data must never enter git, logs, or
  the receipt.

## Proof expiry rules

A receipt is valid until the **first** of:

- 90 days after the live run date (`expiresAt`, checked by
  `isProofReceiptCurrent` — Step 1B wires this into the partner-starts gate);
- a Graph version change (recorded in the receipt);
- an app-mode or Marketing API tier change (both recorded);
- a required permission-access change (recorded);
- a Meta partner-assignment, lead-test, or object-cleanup contract change.

After expiry the proof must be re-run against a fresh external portfolio
before partner starts may be enabled.

## Receipt review procedure

1. The proof_executor commits the receipt and sanitized fixtures at
   `docs/evidence/meta-partner-proof/<date>/receipt.json` (fixtures sit next to
   the receipt).
2. The proof_reviewer — a different person, recorded in the receipt — verifies:
   the commit SHA matches the reviewed tree, probe outcomes are all PASS (or
   explicitly decided), cleanup receipts show no `failed` entries, the
   permission list matches the approved set, and no raw IDs/tokens/lead data
   leaked into the receipt or fixtures.
3. The reviewer records go/no-go. A "go" is only valid while
   `isProofReceiptCurrent` holds under the expiry rules above.

## Why partner sharing does not remove the app gate

Meta has two similarly named but independent access systems:

1. **Marketing API Access Tier** is an app feature. Its current labels are
   `Limited Access` and `Full Access`. Before Meta's 2026 rename, those tier
   labels were `Standard Access` and `Advanced Access`.
2. **Permission access** is evaluated per permission. Permissions such as
   `ads_read` and `ads_management` retain `Standard Access` and
   `Advanced Access` terminology. Meta's Marketing API documentation says an
   app managing other people's ad accounts needs Advanced Access to
   `ads_read` and/or `ads_management`.

Meta explicitly describes Marketing API Access Tier as an App Review feature
and says it is separate from `ads_management`. Therefore a customer assigning
an ad account or Page to the partner Business Portfolio cannot raise the app's
tier or permission access level. Asset sharing is still necessary after app
approval, but it cannot substitute for app approval.

## Official primary sources

- [Meta: Marketing API Access Tier rename and requirements](https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/)
- [Meta Marketing API collection: requirements and permission access](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)
- [Meta Graph API: access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/)
- [Meta permissions reference](https://developers.facebook.com/docs/permissions/reference/)
- [Meta Marketing API onboarding collection](https://www.postman.com/meta/facebook-marketing-api/documentation/9jo4f5y/mapi-onboarding)
- [Meta Lead Ads: create](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/create)
- [Meta Lead Ads: retrieve](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving)
- [Meta Lead Ads: testing and troubleshooting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/testing-troubleshooting)

## Authorized fallback

Keep the normal customer OAuth implementation and Meta App Review submission
moving. Until the app has the required tier and permission access, customers
may receive:

- creative export; and
- publishing performed explicitly and manually by an authorized operator.

Never label the fallback as an API connection. Never display `Connected`,
`Publishing connected`, or equivalent status unless the approved OAuth path has
completed its live capability checks.

## Standing decision record (2026-08-31)

Decision: **NO_GO** — do not build, expose, canary, or sell the automated
partner-assisted Meta connection path until a future receipt records a
reviewed go. This is a fail-closed decision. The evidence available at that
date was insufficient to attempt the live proof safely:

- owner-supplied App Dashboard screenshots showed the app as unpublished with
  App Review incomplete;
- neither `META_BUSINESS_ID` nor `META_SYSTEM_USER_TOKEN` was present in the
  inspected process environment;
- product compose declarations have empty defaults for both settings and are
  not proof of configured credentials;
- no genuinely external, non-app-role test business had been supplied;
- no independent human reviewer existed for the proof;
- no external run occurred;
- no Meta campaign, ad set, form, creative, ad, or test lead was created,
  changed, archived, or deleted.

The sanitized stop receipt records these absences. It contains no token, raw
Meta object ID, business or account name, person name, lead data, or customer
data. Screenshots remain owner-supplied context and are not copied into the
evidence directory.

The stop controls below remain in force until a reviewed, current receipt
records a go:

- do not enable a partner rollout flag for any workspace;
- do not ask a paying customer to share assets for this proposed connection;
- do not use an app-role or app-owned account as substitute external evidence;
- retain the current OAuth path without weakening its review requirements.

(The Step 0 proof tooling itself is now authorized and implemented as this
runbook describes; it performs no Meta writes outside the flag-gated,
disposable `--full-path` run against an attested external portfolio.)
