# Guides editorial redesign — 7 September 2026

## Live release

The rounded editorial guides redesign is live in integrated application revision
`9b5946a23872cde7dc571e9d79e4b0c7abf16f11`. That release preserves the
concurrent pricing redesign and includes guides application commit
`f21043fff1af0a0ad63eff813f16dbf71952c87a`.

The guide library now uses a content-first introduction, a useful featured guide,
topic navigation, rounded article cards, warm reading surfaces, and quiet
publication chrome. The hard signup action was removed from the guide header.
The existing end-of-article Blockwise note remains as the deliberately subtle
product path.

## Verification

- `npm run check:nul`, full `npm test`, `npm run typecheck`, and `npm run build` passed for the guide application change.
- Focused guide routing and practical-content tests passed after the final CSS refinement.
- Preview browser checks covered all nine guide routes at 390 px and 1440 px with no horizontal overflow, console errors, missing landmarks, or duplicate page headings.
- The live integrated release passed the same 18 route/viewport checks.
- `scripts/vps/product-health.sh 9b5946a23872cde7dc571e9d79e4b0c7abf16f11` verified the exact serving revision.
- The concurrent pricing page remained present after integration.

## Release coordination

An initial guides deployment briefly replaced a concurrent pricing release.
The collision was detected during live verification, both changes were combined,
and the integrated revision above replaced the transient deployment. Future
releases must preserve `9b5946a23872cde7dc571e9d79e4b0c7abf16f11` ancestry.
