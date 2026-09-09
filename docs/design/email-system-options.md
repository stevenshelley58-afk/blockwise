# Blockwise email system — three design directions

Status: design options, not a change to outgoing email. 7 September 2026.

## Shared visual contract

Authority: `DESIGN.md`, Premium v2 / the quiet operations desk. Reuse the staircase
mark, lower-case wordmark, Operations Ink, neutral surfaces, fine boundaries,
compact bold headings, mono metadata and one dominant pill action. No new accent
family, stock hero image, decorative chart or animation. The email-specific dark
palette is a neutral counterpart to the approved light tokens, not a product-wide
theme change. Email text/touch sizes are enlarged where needed for inbox reading.

1. **Quiet card — recommended.** A calm framed message with the brand above it.
   The most versatile default across account actions, alerts, billing and updates.
2. **Personal letter.** Flat, left-aligned correspondence with a human sign-off.
   The least visually boxed-in option, especially suited to welcome and editorial copy.
3. **Operations brief.** A compact branded header, rules and clearly grouped facts.
   The strongest information hierarchy for alerts, summaries and receipts.

These are alternatives for one shared system, not three styles to mix at random.
The selected direction can cover all categories through common optional modules.

## Email transport constraints

- Pure HTML and a plain-text companion; essential styles are inline.
- Fluid presentation tables, readable 320px layouts, useful without images.
- No image, webfont, tracking pixel, JavaScript or animation download in the email.
- Manrope / Inter can be used when already installed, with immediate system fallback.
  The review website uses the existing product fonts; the email does not fetch them.
- Native dark-mode styles plus neutral fallbacks. Browser theme previews show the
  intended light/dark output, not an emulation of Gmail or Outlook auto-inversion.
- No credentials, auth codes, customer records, payments or production delivery.
  All data in the examples is fictional. Preview actions cannot sign in or send mail.

Do not describe browser checks as email-client certification. Before integrating
the chosen option, use real received-message checks in Gmail web/iOS/Android,
Apple Mail macOS/iOS, Outlook web/new/classic Windows, with light/dark modes and
images disabled. Check long content, forwarded messages, screen readers, native
link generation and the plain-text MIME part. Actual delivery latency depends on
the sender and receiving provider; tiny HTML only addresses rendering/download cost.

## Reuse and integration boundary

The existing app has delivery/outbox machinery, but no shared branded renderer.
A small dependency-free renderer is justified for the reusable layout modules;
adding another framework or external template service is not necessary.

The review is a real Next route in the existing frontend, using the existing logo,
button components and design tokens. Fixtures are separate from presentation.
The pure renderer is deliberately not connected to `src/lib/email/provider.ts`,
the outbox, lead lifecycle mail, billing events or the auth provider's templates.
After Steven chooses a direction, adapt those producers to a reviewed common
message contract and supply real safe URLs/expiry values/preferences links.
Authentication templates need their provider-specific token variables preserved.
No marketing-preference or unsubscribe integration is claimed by this mockup.

## Compatibility references

- [Gmail's supported CSS and media queries](https://developers.google.com/workspace/gmail/design/css)
  — width/orientation/resolution queries are documented; unsupported styles may be ignored.
- [Can I Email: prefers-color-scheme tests](https://www.caniemail.com/features/css-at-media-prefers-color-scheme/)
  — client-by-client native dark-mode support differs.

Both consulted 7 September 2026. These inform implementation choices, not a claim
that our specific rendered emails have passed those clients.
