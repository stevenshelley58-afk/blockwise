# Mobile customer shell release note (8 September 2026)

## Scope

This candidate makes the customer navigation and Ad Studio editor workable at phone widths. The Ads hub now opens with a New ad action, recent saved ads, and compact links to templates, the media library, and Brand Pack.

## Editor safety

- In-app ordinary same-origin links and the editor Back control ask before discarding unsaved editor work, then navigate through the client router after confirmation.
- Cancelling the prompt leaves the current URL and editor state unchanged.
- Modified clicks, downloads, new-window links, external links, and same-document anchors retain browser-native behaviour.
- The native before-unload prompt remains for hard page exits.
- Save revision conflict handling and publish's saved-revision requirement are unchanged.

## Known browser limitation

Browser Back and Forward are client-side history traversals. Current browser navigation APIs do not provide a reliable, cross-browser way to cancel those traversals after they start. This release deliberately does not add a history sentinel or URL-rewriting workaround. Users are protected for the tested in-app exit paths and hard unloads; browser-history exits can still leave the editor without the in-app confirmation.

## Validation

Focused helper and editor contract tests passed. The mobile browser suite is prepared for the authenticated controlled canary and blocks mutating requests; it has not been represented as a live acceptance result here.