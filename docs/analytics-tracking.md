# Marketing measurement

GA4 and Microsoft Clarity are optional browser integrations. Set these public
build-time values only after a Blockwise-owned provider property/project exists:

NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-...
NEXT_PUBLIC_CLARITY_PROJECT_ID=...

Blank or malformed values keep the provider disabled. The IDs are public
configuration, not secrets, but must not be committed into environment files.

## Consent and privacy

- GA4, Clarity, Meta Pixel, and Google Ads load only after **Accept all**.
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
| sign_up | Email signup confirmation | method |

After deployment, verify a consented session in GA4 DebugView and Clarity,
then mark generate_lead and sign_up as GA4 key events. Provider account
creation, environment setup, and release are operational steps; code alone does
not mean measurement is live.
