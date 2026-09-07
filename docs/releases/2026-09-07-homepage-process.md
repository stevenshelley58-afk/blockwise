# Homepage process explainer preview — 2026-09-07

- Preview: https://blockwise.sale/homepage-preview/process-iteration/concept
- Source: `codex/process-explainer-revision-20260907`
- Revision: `118f6707`
- Container: `blockwise-process-preview-118f67079205`
- Scope: isolated `#how-it-works` process explainer only. The shared `/homepage-preview/*` route and product routes are unchanged.

## Verification

- `npm run check:nul`
- `node --import tsx --test tests/homepage-concept.test.mjs`
- `npm run typecheck`
- production build with `BLOCKWISE_HOMEPAGE_PREVIEW=true BLOCKWISE_PREVIEW_BASE_PATH=/homepage-preview/process-iteration`
- desktop/390px/320px screenshots: `/tmp/process-explainer-final-desktop.png`, `/tmp/process-explainer-final-phone390.png`, `/tmp/process-explainer-final-phone320.png`
- scrolled process frames: `/tmp/process-explainer-frame-choose.png`, `/tmp/process-explainer-frame-editing.png`, `/tmp/process-explainer-frame-review.png`
- browser QA confirmed live selection + character replacement + caret, pause stability, reduced-motion static state, no-JS content, valid route, and no process overflow.

This is a static, secret-free mockup. It does not publish ads or approve spend.
