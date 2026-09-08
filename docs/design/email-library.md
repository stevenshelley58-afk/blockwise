# Blockwise email library — Quiet card

Version 1.1.0. Quiet card approved by Steven on 7 September 2026.
Daily, weekly and new-lead designs expanded on 8 September 2026.

44 reusable templates in the existing Blockwise design system. This is a template
library, not an email sender or newsletter schedule. All supplied example names,
events, figures, dates and links are fictional. Do not send the examples.

## Open and reuse

- Browse: https://blockwise.sale/email-preview/email-library
- Stored in Frank: https://frank.fail/api/chat/uploads/library/blockwise-email/2026-09-08-v1.1/blockwise-email-library.zip?download=1
- Frank README: https://frank.fail/api/chat/uploads/library/blockwise-email/2026-09-08-v1.1/README.md
- Persistent VPS location: `/srv/frank/data/window/uploads/library/blockwise-email/2026-09-08-v1.1/`.

Frank's existing file-download route serves this versioned library. No new Frank
app screen, database, agent runtime or live-mail integration was created. The ZIP
contains the reusable source, template definitions, inventory, filled example
values and matching HTML/plain-text samples. `manifest.json` records the source
revision and SHA-256 hashes of library files. Keep previous versions when updating.

### Package contents

- `source/catalog-data.json`: all 44 definitions with named placeholders.
- `source/catalog.ts`: validated, pure rendering entry point.
- `source/renderer.ts` and `types.ts`: shared email-safe layout and content types.
- `source/examples.ts` and `catalog-examples.json`: isolated fictional review data.
- `templates/<id>.json`: content definition, event guidance and required fields.
- `examples/<id>.values.json`: a starting shape, NOT production-ready values.
- `examples/<id>.html` and `.txt`: adaptive sample render and plain-text companion.
- `inventory.json`: searchable list with categories and required variables.
- `render.mjs`: local rendering command. It cannot send email.

Using Node 22.18 or later, no package installation is needed:

```sh
node render.mjs weekly-newsletter --example ./review
node render.mjs weekly-newsletter ./real-values.json ./rendered
```

The second command validates production values and refuses sample links, missing
fields, sample business identity, invalid subjects and forced preview colours.
Import `buildTemplate(id, values)` from `source/catalog.ts` in future integrations;
it returns subject, HTML, plain text, delivery category and HTML byte count. Do
not import the examples module into delivery code. Use the existing sending
provider when integration is separately requested; do not add another platform.

## Daily, weekly and new-lead notifications

Browse the focused set at https://blockwise.sale/email-preview/email-notifications.

- Daily summary: new-lead count, ad spend, cost per lead, latest enquiries and one
  action to open the daily report. The period and timezone are explicit.
- Weekly report: the same metric definitions for a seven-day window, comparison
  with the preceding period, campaign breakdown and one report action. This is
  separate from the editorial weekly newsletter.
- New-lead alert: lead name, enquiry type, location, source, receipt time and one
  View lead action. Contact details stay in the authenticated application.

All three are optional notifications with separate preference metadata and scoped
unsubscribe wording. A person may select any combination. Disabling daily reports
must not disable weekly reports or instant lead alerts. Before delivery, the sender
must check the exact user's current setting and build the corresponding scoped
unsubscribe URL. The template renderer does not mutate or enforce profile settings.

The current canonical Settings source has `leadAlerts` and `weeklyDigest`, but no
`dailyDigest` control. The daily control is requested product behaviour, not a
verified live feature. No preference UI, scheduling or sender changes are made in
this design task. Missing preferences should fail closed in a future sender.

Daily and weekly include `standard`, `quiet` and `delayed` sample states, accessible
in the review UI and under `examples/`. Zero leads show no invented cost per lead.
Delayed reporting uses Pending rather than zero; neither state reuses stale lead
rows. These are presentation examples, not live data calculations. Future reporting
adapters must compute consistent windows, deduplicate leads, use fresh provider
snapshots, divide spend by leads only when that denominator is positive, and omit
comparisons when no comparable prior window exists. The sample comparison is in
absolute leads, not a claimed statistical improvement. Respect timezone/DST when
building day/week windows. A scheduled report may still be useful on a quiet day;
any skip-empty delivery rule is separate and was not enabled here.

```sh
node render.mjs daily-digest --example=quiet ./review
node render.mjs weekly-performance --example=delayed ./review
```

The shared card now has an optional lead-count/metric block and compact activity
rows. All required dynamic content remains plain text and is escaped. Never
interpolate raw HTML or connect the public preview to real customer lead records.

## What is included

| Category | Templates |
| --- | --- |
| Account & security (8) | Sign-in link/code, verify email, reset password, password changed, email change, new sign-in, team invitation, data export ready |
| Onboarding (5) | Welcome, setup reminder, first ad ready, trial ending, trial ended |
| Ads & campaigns (8) | Ad ready for review, changes requested, campaign live, paused, completed, publishing failed, connection needs attention, budget alert |
| Leads & reporting (5) | New lead, lead assigned, follow-up reminder, daily digest, weekly performance report |
| Billing (7) | Payment receipt, payment failed, subscription started, renewal reminder, subscription cancelled, refund confirmed, credits low |
| Support & service (5) | Support received, support reply, maintenance notice, service incident, incident resolved |
| Newsletters & marketing (6) | Weekly newsletter, product update, practical tip, re-engagement, event invitation, feedback request |

Template availability does not assert that every corresponding product feature
currently exists. Connect a template only when that feature and event are real.

## Weekly newsletter structure

A separate editorial newsletter, not the weekly account-performance report:

1. Issue label, short subject and preview text.
2. Personal greeting and a useful editor's note.
3. One to five stories: heading, short body, optional bullets and an article link.
4. One practical tip and a next step.
5. One primary action to the web edition.
6. Sender identity, support, preferences and unsubscribe.

Required values are listed in its definition. `stories` is an array of objects
with `heading`, `body`, optional `bullets`, and optional
`link: { label, href }`. Use real published URLs, verify time-sensitive claims and
review the issue before delivery. The supplied evergreen example is not a claim
about this week's news. Scheduling is intentionally absent.

## Design and speed

Quiet card is the only approved catalogue layout. Earlier design explorations
remain available separately, but production catalogue rendering does not accept a
design override. Shared brand details: six-cell staircase mark, lowercase
wordmark, neutral ink actions, pale canvas, generous spacing, quiet labels and
rounded cards. Dark colours are neutral counterparts, not a new accent palette.

The email uses HTML text and presentation tables, inline essentials, a hidden
preheader, a fluid single-column layout capped at 600px, and a matching plain-text
version. There are no images, remote font downloads, scripts, tracking pixels or
new dependencies. The logo is a small HTML table with a text wordmark. Primary
actions use a 44px minimum and border-based spacing; narrow detail rows stack.
System fonts deliberately replace downloaded brand fonts for speed and reliability.

The builder enforces a 32,000-byte UTF-8 HTML ceiling; sample-size checks are
stricter at 25,000 bytes. `inventory.json` contains measured sizes. This is a
payload measure, not a guarantee of SMTP or provider delivery latency. Provider
headers, tracking rewrites and surrounding markup can add bytes; check final mail.

## Light and dark mode: no recipient detection needed

Always send `colorMode: "system"` (the production default). One HTML email includes
inline light-mode styles, colour-scheme metadata, a `prefers-color-scheme: dark`
stylesheet and an Outlook dark-mode selector fallback. The recipient's mail app
chooses locally when opening the message if it supports these features. The
sender does not learn that setting, and a website's saved theme does not reliably
represent a recipient's mail-app theme.

Other mail apps ignore those rules or transform colours themselves. Layout,
meaning and useful text remain without theme CSS; exact appearance cannot be
forced across Gmail, Outlook and Apple Mail. Preview light/dark switches simulate
our two palettes, not every client's automatic inversion. Round corners can
become square in older Outlook versions without losing content or actions.

References: [Gmail supported CSS](https://developers.google.com/workspace/gmail/design/css),
[dark-scheme CSS support](https://www.caniemail.com/features/css-at-media-prefers-color-scheme/),
[colour-scheme metadata support](https://www.caniemail.com/features/html-meta-color-scheme/).

## Before connecting a sender

- Supply actual business identity/address and working absolute HTTPS support URLs.
  Do not send preview domains, dummy codes, simulated metrics or sample copy.
- Preserve real auth token semantics, single-use behaviour and expiry. Never log
  codes or store filled security messages in public preview storage.
- Map account/service messages to verified events and the correct workspace and
  recipient. Examples: confirm payment before a receipt, provider publishing
  state before a live notice, and refund confirmation before a refund email.
- Marketing templates require eligible opted-in subscribers, real per-recipient
  unsubscribe/preferences links, and suppression checks at send time. Optional
  reports also honour their notification preferences. The renderer cannot prove
  consent, enforce suppressions or process unsubscribes by itself.
- Keep promotional messages separate from essential account/security emails.
  Labels here are operational guidance, not a deliverability or compliance certificate.
- Use multipart HTML plus plain text. Configure sender identity, authentication,
  bounce handling, deduplication and retries in the existing provider integration.
- For subscription emails, implement the provider's supported one-click
  unsubscribe headers in addition to the visible footer link where applicable.
- Test received messages with images blocked and on desktop/mobile Gmail,
  Apple Mail and Outlook, in light and dark mode. Check links, text contrast,
  long names, large text settings and any provider HTML rewriting. Browser
  previews and automated tests are not received-inbox certification.

No emails have been sent and no weekly job has been scheduled by this library.
