# Native Ad Studio editor trial

The owner approved an opt-in Vue Fabric Editor trial on 12 September 2026.
The old editor is retained. This document describes the integration, not a
claim that all templates or live provider publishing have passed acceptance.

## Intent

Use the upstream editor's native document and editing/rendering capabilities.
Template conversion is a one-time starting operation; subsequent edits remain
native. Do not maintain a second custom canvas editor or force native edits
through the old restricted layout format.

The four product integrations are:

1. Existing template text, images and fonts as the starting design.
2. Existing AI copy proposals, applied only after the customer chooses them.
3. Feed and Story previews of the native edited artwork in an ad frame.
4. Immutable saved revisions and the existing review/publish workflow.

## Safety boundary

The upstream app is self-hosted, pinned and isolated from the host's styles.
Its browser messages must verify both source window and same origin. Template
and workspace media use Blockwise's own authorised endpoints; upstream cloud
accounts, remote uploads and third-party template services are not integrations.

Trying the editor creates a separate copy of the source ad. The original is not
overwritten. Saved native documents identify the editor and retain both scenes.
The old save path must reject them instead of rerendering the original layout.

A native save captures both scenes and their PNG exports as one frozen snapshot.
The server validates ownership, document bounds, image formats and dimensions,
copy limits and the expected revision, then persists image hashes and the
revision together. Publishing consumes that saved revision, not a browser's
unsaved current state.

This changes the authoritative renderer for native revisions: it is the pinned
Vue/Fabric export, not the legacy Blockwise template renderer. It does not claim
that a submitted bitmap can be cryptographically proven to match arbitrary
untrusted JSON. Provider gates and workspace isolation remain unchanged.

## Acceptance

- Original ad and old-editor route remain usable.
- Template copy, fonts, images and both sizes load.
- Free-form text/layout edits survive save and reopen.
- Explicit AI suggestion application updates bound text without erasing other
  design elements.
- The ad preview shows the current edited images.
- The saved PNG hashes are those carried into publish review.
- Stale saves, malformed exports and cross-workspace access are rejected.
- Desktop and mobile behavior are reported at the actually tested scope.

See the dated release record for the pinned application revision and observed
checks. No live Meta action is authorised by editor installation.
