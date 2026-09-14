# Publish-flow comparison, 14 September 2026

## Review surface

`/ad-studio/publish-history` is a deliberately isolated, authenticated archive
of the four-stage publish UI at `aa3b081c53cdb9c331666ae184bdab4b333ef3b1`.
It uses example data and current shared styling. Networked form editing and
all publish, activation and manual-request actions are removed. It is an
adapted historical comparison, not a production rollback or pixel-exact snapshot.
The current publish header links to it in a separate browser tab.

## Proposed next flow (not implemented by this comparison)

1. Ads: one or several saved ads; Feed and Story are placement assets, not
   implicitly separate user-created ads.
2. Lead form: a complete editable draft for each distinct ad/offer, derived from
   saved copy and approved workspace information. Missing privacy, destination
   or delivery facts are explicit blockers, never invented values. Reuse an
   identical form when appropriate; do not overwrite user edits on regeneration.
3. Targeting and budget: reuse one default lead campaign and one compatible
   default ad set per workspace/ad account. Show the existing shared spend,
   location and schedule. Additional ads do not silently increase the budget.
4. Review and publish: one explicit approval of what will be added or changed,
   with spend scope and validated delivery/setup. Report provider-confirmed
   review, active, delivering, rejected or failed state honestly.

Advanced overrides: new campaign/new ad set; existing campaign/new ad set;
existing campaign/existing ad set. An ad set belongs to its campaign, so a new
campaign cannot reuse an ad set belonging to another campaign. Validate objective,
account, capture destination and category compatibility before reusing parents.
Multiple destinations must disclose duplication, parent-level budget effects,
partial failures and retry behaviour. Existing campaigns and ads are managed
from Results, not through a miniature Ads Manager in the default publish path.

Separate ad sets are warranted for independently controlled geography, schedule,
budget or optimisation. Existing parent settings must not be silently overwritten,
and paused parents must not be automatically enabled if doing so revives other ads.

Before release of that redesign, validate lead routing, agent notifications,
offer delivery, privacy/consent, country-specific housing restrictions, account
permissions/payment readiness, and budget/currency/timezone source. Budget targets
must not be presented as guaranteed cost per lead or a hard daily cap.
