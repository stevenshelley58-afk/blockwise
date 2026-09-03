# Meta Partner External Proof Gate

- Decision date: 2026-08-31
- Decision: **NO_GO**
- Proof state: **UNPROVEN**
- Machine-readable receipt:
  [`../evidence/meta-partner-proof/2026-08-31/receipt.json`](../evidence/meta-partner-proof/2026-08-31/receipt.json)
- Applies to: the automated Meta Business Portfolio partner-assisted customer
  connection path
- Does not block: customer OAuth, Meta App Review, creative export, or explicitly
  manual/operator publishing

## Decision

Do not build, expose, canary, or sell the automated partner-assisted Meta
connection path. The required external-account proof did not run and cannot be
represented as passed.

This is a fail-closed decision. Official Meta material makes the app's
Marketing API tier and each requested permission's access level separate
controls. Sharing a customer's assets to a partner Business Portfolio changes
which assets the partner may access; it does not promote the receiving app to
Marketing API Access Tier Full Access or grant Advanced Access to an individual
permission.

The current evidence is insufficient to attempt the live proof safely:

- owner-supplied App Dashboard screenshots show the app as unpublished with App
  Review incomplete;
- neither `META_BUSINESS_ID` nor `META_SYSTEM_USER_TOKEN` is present in the
  inspected process environment;
- product compose declarations have empty defaults for both settings and are
  not proof of configured credentials;
- no genuinely external, non-app-role test business has been supplied;
- no independent human reviewer exists for the proof;
- no external run occurred;
- no Meta campaign, ad set, form, creative, ad, or test lead was created,
  changed, archived, or deleted.

The sanitized receipt records these absences. It contains no token, raw Meta
object ID, business or account name, person name, lead data, or customer data.

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

## Evidence reviewed

| Evidence                                             | Observed result                                                                       | Consequence                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Meta App Dashboard screenshots supplied by the owner | App unpublished; App Review incomplete                                                | No claim of external production access is permitted |
| Marketing API Access Tier documentation              | App feature uses Limited/Full tier labels                                             | Partner asset sharing cannot promote the app        |
| Marketing API permissions documentation              | Other people's ad accounts need Advanced Access to `ads_read` and/or `ads_management` | Asset assignment alone is insufficient              |
| Process configuration presence check                 | Business ID absent; system-user token absent                                          | Live external proof cannot start                    |
| Product compose configuration                        | Both settings default to empty                                                        | Declaration is not usable configuration             |
| External fixture availability                        | No unrelated non-app-role business supplied                                           | Required test boundary is absent                    |
| Review independence                                  | No second human reviewer supplied                                                     | Proof cannot satisfy review requirements            |
| Live Meta execution                                  | Not run                                                                               | All read/write/cleanup outcomes remain unproven     |

Screenshots remain owner-supplied context and are not copied into this evidence
directory. The receipt stores only their sanitized interpretation.

## Official primary sources

- [Meta: Marketing API Access Tier rename and requirements](https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/)
- [Meta Marketing API collection: requirements and permission access](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)
- [Meta Graph API: access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/)
- [Meta permissions reference](https://developers.facebook.com/docs/permissions/reference/)
- [Meta Marketing API onboarding collection](https://www.postman.com/meta/facebook-marketing-api/documentation/9jo4f5y/mapi-onboarding)
- [Meta Lead Ads: create](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/create)
- [Meta Lead Ads: retrieve](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving)
- [Meta Lead Ads: testing and troubleshooting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/testing-troubleshooting)

The inference about partner sharing follows from the first two sources: app
tier and permission access are app controls, while partner assignment controls
asset availability. No source says an asset owner can upgrade another party's
app tier by sharing an asset.

## Authorized fallback

Keep the normal customer OAuth implementation and Meta App Review submission
moving. Until the app has the required tier and permission access, customers
may receive:

- creative export; and
- publishing performed explicitly and manually by an authorized operator.

Never label the fallback as an API connection. Never display `Connected`,
`Publishing connected`, or equivalent status unless the approved OAuth path has
completed its live capability checks.

## Hard stop controls

Until a later proof receipt records `decision: GO` and `proof_status: PASSED`:

- do not implement Steps 1–9 of the partner-assisted connection plan;
- do not enable a partner rollout flag for any workspace;
- do not add or run a write-capable partner proof script;
- do not ask a paying customer to share assets for this proposed connection;
- do not use an app-role or app-owned account as substitute external evidence;
- retain the current OAuth path without weakening its review requirements.

## Conditions required before a recheck

A recheck may be scheduled only after every prerequisite below is true:

1. The app is published and the required App Review work is complete.
2. The App Dashboard shows Marketing API Access Tier `Full Access`.
3. Each required permission shows the access level needed for managing an
   unrelated business, including Advanced Access where Meta requires it.
4. The Business ID is configured in the controlled runtime.
5. The system-user token exists in the approved private provider-token vault;
   it must not be placed in repository files or command history.
6. A disposable external Business Portfolio is available, is unrelated to the
   app owner, and none of its users are app admins, developers, or testers.
7. A named executor and a different independent human reviewer are available.
8. The current Graph version, required permissions, Leads Access Manager state,
   cleanup operations, and Meta object contracts have been re-read from Meta's
   current primary documentation.

A change to Graph version, app mode, Marketing API tier, permission access,
Meta object status contract, Lead Ads test contract, or partner-assignment
contract also triggers re-evaluation. The current receipt is already expired;
it is a stop receipt, not reusable proof.

## Future controlled proof protocol

This section corrects the object semantics in the original plan. It is a review
checklist for a separately authorized future run, not executable tooling.

### Status and delivery safety

- Campaign, ad set, and ad are delivery-bearing objects. Create each with
  `status=PAUSED`, then read it back and require the effective status to remain
  non-delivering.
- An Instant Form and an ad creative do not accept the campaign delivery status
  `PAUSED`. Do not invent or send it for those object types.
- Create the form and creative only inside the bounded proof window, after the
  paused campaign hierarchy exists. Attach them only to a paused ad.
- A Page-linked Instagram account returned by a discovery edge proves only a
  relationship. It does not prove that the identity may be used for the ad.
  Ad-identity proof requires a paused creative/ad using that Instagram actor and
  a successful ownership/readback check.

### Lead test sequence

Before testing, record that the app/CRM and executing system user have the
required Page lead access in Leads Access Manager. A Page or form read does not
prove lead retrieval access.

The future proof must perform and receipt the documented lifecycle in order:

1. `POST /{form-id}/test_leads` to create one synthetic test lead.
2. `GET /{form-id}/test_leads` and the repository lead adapter to prove the
   created lead is retrievable through the intended integration.
3. `DELETE /{lead-id}` to remove the synthetic test lead after retrieval.

Only synthetic values are allowed. Raw lead or object IDs and field data must
never enter git, logs, screenshots, or the sanitized receipt.

### Cleanup is terminal state, not physical-erasure proof

Meta object deletion commonly means archive or an object-specific terminal
operation, not guaranteed physical deletion. Cleanup must be performed by
object type and verified by readback:

1. Delete the synthetic test lead using the documented test-lead delete call.
2. Archive/delete the paused ad and verify it cannot deliver.
3. Archive/delete the ad set and verify it cannot deliver.
4. Archive/delete the campaign and verify it cannot deliver.
5. Delete the ad creative through its supported delete edge after delivery
   references are terminal; record a retained/non-serving result if Meta keeps
   the object.
6. Archive the Instant Form through its supported form operation; a form must
   never be assigned `PAUSED`.

The future receipt must report the exact terminal result for every type. It
must not claim physical deletion unless Meta's readback contract proves that
specific outcome.

## Failure interpretation

| Observation                                                         | Classification                       | Required action                                                 |
| ------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| App tier is Limited Access                                          | `marketing_api_full_access_missing`  | Stop; continue Meta approval work                               |
| Required permission is Standard when Advanced is required           | `permission_advanced_access_missing` | Stop; complete permission review                                |
| Business ID or vault token absent                                   | `partner_credentials_missing`        | Stop; configure only after approval                             |
| Account/Page missing after share                                    | `asset_not_shared`                   | Correct partner asset assignment; do not infer app-tier failure |
| Page-linked Instagram identity discovered but rejected on paused ad | `instagram_ad_identity_unproven`     | Do not offer Instagram selection                                |
| Test lead POST succeeds but GET fails                               | `lead_retrieval_unproven`            | Verify Leads Access Manager and permission state; stop          |
| No independent reviewer                                             | `independent_review_missing`         | Stop; receipt cannot pass                                       |
| Any object can deliver or cleanup is incomplete                     | `cleanup_or_delivery_safety_failed`  | Stop, contain manually, record sanitized failure                |

## Proof expiry

A successful future receipt expires at the earliest of:

- 90 days after the live run;
- a Graph version change;
- an app-mode or Marketing API tier change;
- a required permission-access change;
- a Meta partner-assignment, lead-test, or object-cleanup contract change.

This 2026-08-31 receipt is `UNPROVEN` and expired at issuance. It authorizes no
partner rollout.
