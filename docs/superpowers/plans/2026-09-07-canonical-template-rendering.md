# Canonical template rendering - bounded implementation plan

## Goal

Make the structured AdDocument the authoritative visual input for resting editor previews and final saves/exports. Reuse the existing renderer; Fabric remains only a transient interaction surface while edits or uploads are not yet representable as server-resolvable references.

## Feasibility and boundaries

- The existing contract already models shared text/images, independent Feed and Story crops, colour modes, and revisions.
- save-ad.ts already renders both placements with the canonical renderer.
- The current gap is LayeredCanvas, which independently paints the template in Fabric. It shares text-layout helpers but not all rendering semantics.
- Add a workspace-authorized, read-only preview service/route that accepts a validated AdDocument, resolves only workspace-owned customer assets and selected immutable template assets, and returns canonical PNG bytes. It must not insert rows, upload files, or change revision pointers.
- Use deterministic identities: canonical document hash plus immutable template JSON hash, placement, and renderer version. Client requests carry a monotonic request token; late responses are discarded.
- Keep unsaved local object/data URLs visibly editable through the existing Fabric fallback until uploads finalize; canonical preview becomes authoritative as soon as all required values are server-resolvable.

## Files/slices

1. Add a small renderer adapter/service shared by preview and save to resolve AdDocument values and compute template/document identities.
2. Add POST /api/adstudio/ads/[id]/preview with existing request auth and workspace/ad/template ownership checks; validate adDocumentSchema, reject inline images, resolve assets read-only, render one placement, and return PNG plus identity headers/metadata.
3. Wire EditorShell preview panes to the route with stale-response guards; preserve Fabric hit testing and crop controls. No second drawing engine.
4. Populate ad_revisions.template_hash from canonical immutable template JSON in save-ad.ts (existing column; no migration expected).
5. Add behavioral tests for preview/save byte parity, stale response discard, swaps, long Unicode text, per-placement crops, defaults, document hashing, auth/RLS boundaries, and inline-image rejection.

## Acceptance

For identical validated document, assets, colour map, template JSON, and renderer version, preview PNG bytes equal save PNG bytes. Preview failures are non-persistent and do not expose paths, provider fields, or cross-workspace assets. Required/default validation remains distinct from save: previews may render placeholders/defaults while save still requires customer-required values.

