# Marketing measurement

GA4 and Microsoft Clarity are optional browser integrations. Set these public
build-time values only after a Blockwise-owned provider property/project exists:

NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-...
NEXT_PUBLIC_CLARITY_PROJECT_ID=...

Blank or malformed values keep the provider disabled. The IDs are public
configuration, not secrets, but must not be committed into environment files.

## Consent and privacy

- GA4, Clarity and the Meta Pixel load only after **Accept all**.
- **Essential only** keeps third-party providers disabled and updates Google
  Consent Mode v2 to denied if a Google tag is present.
- The existing first-party page counter remains separate: it is cookie-free,
  strips query strings, stores no raw IP/user-agent, and excludes operator/API
  paths.
- External custom event properties are allow-listed. Emails, names, phones,
  free text, postcodes, URLs, IDs, query strings, and referrers are dropped.
- Clarity uses Consent API v2. Replay is limited to home, pricing and guides without URL queries or fragments; it stops on navigation or consent withdrawal. A new full page load starts the next eligible recording.
- Clarity receives no user identity calls. Apply data-clarity-mask="true" to
  any new field that can contain a visitor's information.

## Events

| Event | Trigger | Allowed context |
| --- | --- | --- |
| page_view | Public marketing route | page_type |
| cta_clicked | Marketing CTA selected | cta_location, page_type |
| demo_requested | Managed-setup CTA selected | cta_location, page_type |
| generate_lead | Confirmed managed-setup lead save | form_type, page_type |
| sign_up | Pending: confirmation currently lands on excluded private self-serve route | Not launch-verified |

After deployment, verify a consented session in GA4 DebugView and Clarity,
then mark generate_lead as a GA4 key event after a verified save. Do not mark sign_up ready until its private-route handoff is implemented and tested. Provider account
creation, environment setup, and release are operational steps; code alone does
not mean measurement is live.

## GA4 activation - 2026-09-07

Approved Blockwise account: 407072065. Property: 553012529 (Perth, AUD).
Web stream: Blockwise website, https://blockwise.sale.
Public measurement ID: G-PX6NWGX9B5, configured through the protected VPS environment.
Optional account data sharing and enhanced measurement are off. Page views are
manual to prevent duplicate history tracking or accidental query/form capture.
A loaded GA4 tag is opted out on private routes, consent withdrawal, and unmount.
Initial automatic-event page title is fixed to Blockwise; explicit events use safe page types.
Clarity remains disabled until a project is connected. No private-product analytics
or completed-registration measurement is claimed by this activation.

References: [manual page views](https://developers.google.com/analytics/devguides/collection/ga4/views),
[Google opt-out](https://developers.google.com/tag-platform/security/guides/privacy).

Visitors can reopen the existing consent banner with **Change cookie preferences**
on `/privacy`. This uses the same stored consent and provider update path as first visit.
