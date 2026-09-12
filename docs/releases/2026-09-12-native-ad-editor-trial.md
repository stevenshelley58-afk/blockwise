# 12 September native Ad Studio editor trial

## Scope

An opt-in, same-origin Vue Fabric Editor trial lives beside the original editor.
Use **Try new editor** on a saved ad. The server creates or reopens one separate
trial copy for that original; it does not charge another pack credit or change
the source ad. Copy-of-copy chains are rejected. Unsaved original edits are not
copied, and the entry action warns before leaving.

Upstream is pinned at b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889, MIT.
Four integrations remain first-party: starting template content; existing AI
copy proposals; Meta-style previews; native revision save into publish review.
Feed and Story have fixed dimensions. Images enter through the existing
workspace media controls. Both scenes freeze before browser PNG rendering.

## Observed verification

- Production Next build and TypeScript checks passed.
- Full repository tests passed: 1,262 passed, two intentionally skipped.
- The real bundled Vue editor passed a Chromium bridge harness under the
  restricted production CSP, with no upstream network requests. It covered
  editing, separate sizes, PNG dimensions, scene round-trip and save messaging.
- A separate React host harness passed copy editing, explicit AI proposal
  application, real bridge snapshot through backend document/PNG validators,
  save/reopen, ad preview and publish-review navigation.
- Harness screenshots were captured at 1440x960 and 390x844. They contain
  synthetic fixtures, not customer ads. AI responses and database persistence
  are mocked in that component harness.
- All 62 currently active template rows converted and passed native scene
  validation. This is structural coverage, not pixel-fidelity acceptance.
- The Impeccable detector reported no findings on the new first-party editor
  components. A bounded cheap visual review confirmed the stock direction
  and flagged synthetic-fixture clarity and incomplete destination metadata.
  The fixture now labels its synthetic agency; destination and publish
  eligibility remain governed by the existing review flow.
- Existing infrastructure test expected an obsolete trusted proxy address;
  its assertion now matches the unchanged maintained environment example.

## Deliberate limits

Authenticated live copy/save/review acceptance is not yet verified: the stored
E2E credentials were rejected by the actual login page, and the user's browser
connection was unavailable. No authentication bypass or password reset was used.
No paid AI request or Meta provider write was made. Provider gates are unchanged.
Template font, crop and text-wrap fidelity still needs review with real ads.

The existing dependency audit reports one high and one critical root advisory
(Next/sharp baseline); this change does not claim an advisory-free dependency
tree or silently perform an unrelated framework upgrade.

## Edge configuration

Frank commit 42bae968b6a049b65ab1b496f6d692c571d5b7b8 permits same-origin
framing only at /vue-ad-editor and its children; other product pages retain
DENY. Its 23 infrastructure tests and Caddy validation passed. The committed
configuration was byte-verified and gracefully loaded through Caddy. A full
Frank deployment stopped at an unrelated unavailable Hindsight loopback API;
that is not claimed as a completed Frank application release.
