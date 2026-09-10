# Postcode outreach dry-run

This is a review-only adapter. It does not scrape, enrich, enqueue, or send email. It does not use Resend for cold outreach and does not claim that legal compliance is automatic.

## Interfaces

The internal import is:

`POST /api/internal/outreach/drafts`

It uses the existing HMAC request headers with scope `outreach.drafts.import`. The contract has no top-level `postcode`. The postcode is carried in both the area snapshot and prospect records, as a string representing recorded agent location only. It is not ad targeting, a definitive suburb, or a guaranteed service area.

The public UI is:

- `/ad-reports/demo`: synthetic report preview.
- `/ad-reports/demo/email`: synthetic Quiet-card email preview.
- `/ad-reports/[token]`: opaque-link report route with no general analytics page-view event.

The shared synthetic fixture supports the `recent_ads_observed`, `no_ads_found_after_successful_recent_scan`, and `unknown` segment variants, plus a one-follow-up email preview. In code, `buildDemoOutreachReport(segment)` supplies the report data and `buildDemoOutreachPreview({ segment, followUp, theme })` supplies the email variant. Demo data is visibly synthetic and is not an import source.

## Import shape

This is an illustrative shape only. The `.example` values must not be treated as production data.

```json
{
  "mode": "validate",
  "idempotencyKey": "demo-import-key-0001",
  "reportBaseUrl": "https://blockwise.sale",
  "businessIdentity": "Blockwise Pty Ltd, Perth, Australia",
  "supportUrl": "https://blockwise.sale/support",
  "unsubscribeUrl": "https://blockwise.sale/preferences/unsubscribe",
  "snapshot": {
    "postcode": "6000",
    "coverageLabel": "Perth",
    "suburbs": ["Perth"],
    "evidence": {
      "status": "unknown",
      "scanId": "demo-area-scan",
      "scannedAt": "2026-09-07T00:00:00.000Z",
      "completed": true,
      "scopeVerified": true,
      "source": "Synthetic fixture",
      "observedAdCount": 0
    },
    "adExamples": [],
    "sourceRightsConfirmed": true
  },
  "prospect": {
    "agentName": "Jordan Example",
    "agencyName": "Example Realty",
    "recordedAgentLocation": "Perth WA",
    "postcode": "6000",
    "agentPageUrl": "https://agent.example/agent",
    "agencyPageUrl": "https://agent.example/agency",
    "contactEmail": "jordan@example.test",
    "advertisingEvidence": {
      "status": "unknown",
      "scanId": "demo-prospect-scan",
      "scannedAt": "2026-09-07T00:00:00.000Z",
      "completed": false,
      "scopeVerified": false,
      "source": "Synthetic fixture",
      "observedAdCount": 0
    },
    "prospectAdExamples": [],
    "contactProvenance": {
      "source": "Synthetic fixture",
      "capturedAt": "2026-09-07T00:00:00.000Z",
      "verifiedAt": "2026-09-07T00:00:00.000Z"
    },
    "consentBasis": "Synthetic fixture only",
    "consentRecordedAt": "2026-09-07T00:00:00.000Z",
    "suppressionClear": true,
    "sourceRightsConfirmed": true,
    "scopeVerified": true,
    "dataFreshAt": "2026-09-07T00:00:00.000Z",
    "isDemo": true
  }
}
```

`isDemo: true` is deliberately rejected by import, including when used to check an import path. Keep this fixture in the UI preview only. A real import requires captured contact verification, dated consent, clear suppression state, current evidence, source rights, and verified scope.

## Evidence and persistence rules

Prospect-specific page evidence determines the segment. Area evidence is shared context and cannot imply that a particular agent advertised. A failed, stale, incomplete, mismatched, or out-of-scope scan becomes `unknown`; it cannot support an absence claim. A neutral unknown prospect may proceed only when the area snapshot is current and source-verified, contact eligibility passes, and three dated, sourced peer examples from three distinct advertisers are available. Three peer examples from three distinct advertisers are required for every segment. A postcode with fewer than three distinct peer advertisers is ineligible with `insufficient_peer_examples`; it does not repeat one agency to fill a card.

The import uses a transactional RPC. Area snapshots and generated artifacts are immutable. Repeated imports with the same idempotency key replay the existing draft; conflicting facts are rejected. The public payload and segment are frozen at draft creation, so a valid report remains available after the 72-hour freshness window unless it is explicitly blocked or revoked. This historical availability does not refresh evidence.

Media is included only when source rights are confirmed and the URL origin is in the configured media allowlist. Public reports contain display facts, dated source links, and permitted media only. They do not expose contact details, consent notes, raw CRM/source payloads, or an authenticated session. The opaque token is a bearer link and appears in the protected report URL and email artifact; treat it as confidential.

The email uses the approved Quiet card, three sourced peer examples from three distinct advertisers, one report CTA, and a genuine unsubscribe destination. One follow-up maximum is represented as a draft variant. No provider write, outbox write, or delivery path is implemented.

## Peer advertiser identity

A peer advertiser is the ad's Meta page name, trimmed and compared
case-insensitively. Each ad carries its own Ad Library URL, so an ad URL is
never the identity: two ads from one page are one advertiser, not two.

Selection puts one example per advertiser first and holds repeats back.
Preferring examples with a confirmed creative reorders within that guarantee, so
a second ad from an advertiser already shown cannot displace a distinct one.

## Before a real pilot

- Connect the actual Ad Radar adapter and verify its evidence scope and freshness.
- Supply a real eligible postcode list and prospect records; never use the demo fixture.
- Prove a genuine unsubscribe and suppression provider path and a shared reply inbox.
- Add conversion measurement for report views and signups; report routes are currently excluded from general analytics for privacy.
- Review source/media permissions and confirm the real business identity and unsubscribe destination.
- Obtain any separate Meta spend and publishing approvals.

## Observed ad creatives

Archived creatives are served from the product storage bucket
`research-ad-creatives`, published at
`${NEXT_PUBLIC_RESEARCH_STORAGE_URL}/storage/v1/object/public/research-ad-creatives/<storagePath>`.
`NEXT_PUBLIC_RESEARCH_STORAGE_URL` and `OUTREACH_MEDIA_ALLOWED_ORIGINS` both
point at the product origin. They previously pointed at `hermes.blockwise.sale`,
which resolves but serves nothing, so every creative on a public report was a
dead link and no outreach email could pass the media allowlist.

The worker archives blobs to `HERMES_AD_DB_ARCHIVE_ROOT`
(`/srv/hermes/ad-db/assets`) under `sha256/<hash>`. Only that scheme is on disk;
older `media-blobs/<hash>.<ext>` paths recorded on cards have no archived file,
so those cards render without media. Publishing the archive into the bucket is
what makes a creative visible; a card whose blob was never archived stays
text-only rather than showing a broken image.

Email creatives are resized derivatives under the `email/` prefix in the same
bucket. Full-size archive blobs reach 15 MB and must not be linked from an
email.
