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

## Simple-first interaction decision (12 September)

Audience: customers who want to get an ad ready, not learn a design tool.
The primary job is to review a credible ad, change its photos or wording, and
continue to the existing publish review. This is an Operate surface.

| Approach | Advantage | Cost / reason not chosen alone |
| --- | --- | --- |
| Stock toolbar visible everywhere | Familiar and immediately powerful for designers | Exposes layers, rulers and styling decisions before the customer's actual job. |
| Hide tools individually | Same canvas and gradually discoverable controls | Still starts with a design task; keeping a heavily modified upstream toolbar in sync adds maintenance. |
| Separate simple/full editors | Each interface can be tailored | Two editing implementations risk lossy conversion, conflicting state, duplicated tests and diverging features. |
| Fixed step-by-step wizard | Clear first-run sequence | Adds navigation for small repeat edits and separates words from their visual effect. |
| Simple ad view plus optional design tools | Common tasks visible; the existing editor remains available | Requires explicit transitions, fresh previews and lossless state handling. Chosen. |

The choice follows progressive disclosure, not automatic guesses about a user's
skill. See [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
and [Modes in User Interfaces](https://www.nngroup.com/articles/modes/).
These are design rationale, not evidence that this implementation has passed
usability testing with customers.

### Contract

- Start on the current native artwork in a realistic ad preview. Photos and Words
  are labelled, visible actions; Review & publish is the primary next step.
- Adjust design reveals the existing Vue editor. Done designing returns to the
  preview. These are views of one document, not conversions or separate saves.
- Keep the same iframe mounted at a nonzero size. Hidden design tools are inert,
  so a customer cannot accidentally operate them by keyboard.
- Snapshot before returning from the design tools, including edits inside the
  native change-notification delay. Do not replace current scenes with an older
  asynchronous preview export.
- Words offers optional AI drafting and manual editing. Proposals never apply
  themselves. Template copy restoration is a deliberate action.
- Simple photo replacement targets a surviving template input in both formats.
  Preserve layout transforms, masks and unrelated custom objects. A deleted slot
  stays deleted. Replacing a photo recrops it to fill the existing frame.
- Shared photo/text inputs are convenience controls, not a promise that freeform
  layout changes automatically adapt to the other format.
- Keep the native save snapshot, revision checks, permissions, original ad and
  publish gate. No new backend, editor engine or publishing path.
- No autosave claim: Save remains explicit and publish review saves pending
  changes before continuing.

The main trade-off is one extra click for detailed design work, in exchange for
removing the design-tool interface from everyone else's starting screen.

## Default entry, 12 September 2026

The approved simple-first editor is now the normal ad entry. The server GET remains read-only; a mounted client launcher performs the existing idempotent copy POST and replaces the URL with the native canvas. Saved native documents and server-marked native copies go directly to the canvas. Original ads remain preserved; only an explicit original-ad URL with ?editor=legacy opens the previous renderer. The trial footer is removed. New copy names retain the source name. Bundled and asset-declared fonts use the same template-scoped aliases in the converter and native bridge. Binary font delivery retains the existing workspace/template checks.
