# Product Rebuild — Blockwise is customer-only

Law (AGENTS.md): **Blockwise is the customer product.** Customers pick
Frank-built template packs, edit ads, Save PNGs, Publish to Meta, and manage
campaigns and billing. Blockwise does **not** scrape ads, write blogs, or
generate templates — those are Frank's tools.

This doc is the inventory of what stays, what is leftover, and what is already
gone. Grep terms audited: `reference_clone`, `reference-clone`,
`buildCloneImageRequest`, `templateClone`, `AD_STUDIO_TEMPLATES`,
`in-place-ad-editor`, `research-runtime`, `content-engine`, `/operator/email`,
`/operator/research`.

---

## (a) KEEP — customer surfaces

| Surface | Paths |
|---|---|
| AdStudio editor (picks Frank packs, edits ads, Save PNG, Publish) | `src/app/(customer)/ad-studio/**`, `src/app/api/adstudio/**`, `src/lib/adstudio/**` |
| Ad Radar customer view (browse/search ads & advertisers) | `src/app/(customer)/ad-radar/**`, `src/app/api/research/ad-radar/**`, `src/app/api/research/ads/**`, `src/app/api/research/advertisers/**`, `src/app/api/research/locations/**`, `src/app/api/research/swipe-file/**` |
| Property check / suburb reports | `src/app/(customer)/property-check/**`, `src/app/suburb/**`, `src/app/api/property-checks/**`, `src/app/api/research/audit/**`, `src/app/api/research/local-ad-radar/**` |
| Booking / leads / results / self-serve / settings / onboarding / connect-meta | `src/app/(customer)/booking`, `(customer)/leads`, `(customer)/results`, `(customer)/self-serve`, `(customer)/settings`, `(customer)/onboarding`, `(customer)/connect-meta`, `src/app/api/leads/**` etc. |
| Customer read-model libs (ad-radar, suburb insights, customer ad library) | `src/lib/research/{public-ad-radar,ad-radar-*,advertiser-autocomplete,audit-suggestions,brand-pack-suburb,customer-ad-library-pages,customer-meta-card,suburb-report-insights,ad-audit,ad-library-api,normalise,hash,meta-official-api,schemas}.ts` |
| Feature gating for customer surfaces | `src/lib/features/route-availability.ts` |
| Operator **customer-ops** surfaces (keep — billing/customers/support, not research) | `src/app/(operator)/operator/customers/**`, `(operator)/operator/database/**`, `(operator)/operator/analytics/**`, `(operator)/operator/prompts/**`, `(operator)/operator/model-control/**`, `(operator)/workforce/**`, `(operator)/operator/page.tsx`, `src/lib/operator/{customers,database,database-format,overview,service-role,auth,prompts}.ts` |
| VPS durable job worker (provider/meta/activation jobs — no research) | `worker/**` (handlers are provider/leads/meta-monitor/activation only) |

## (b) DELETE — leftover clone/research/content code

### B1. Operator research surface (Ad Radar ops console + Hermes research runtime)

All of these are operator-only tooling for the scraper/classifier pipeline that
Blockwise no longer owns. Importers are internal to the group unless noted.

- Pages: `src/app/(operator)/operator/research/page.tsx`, `src/app/(operator)/operator/research/drain/page.tsx`
- API routes (27): `src/app/api/operator/research/**` — ads/[id]/display-state, chat, coverage, defects/**, drain-status, files, health, jobs/**, kill-switch, meta-api-validation, policies, refresh-now, runs/**, skills/**
- Components: `src/components/operator/research-console.tsx`, `research-console-styles.ts`, `research-drain-dashboard.tsx`, `operator-assistant.tsx`
- Libs (operator-only, importers only inside B1): `src/lib/operator/hermes-assets.ts`, `src/lib/operator/assistant.ts` (only importer: api/operator/research/chat), `src/lib/operator/postcode-refresh.ts` (importers: refresh-now route, assistant.ts)
- `src/lib/research/service.ts` — **has external importers**: `src/app/api/health/research/route.ts` and `src/app/api/alerts/paid-service-watchdog/route.ts` use `createResearchServiceClient`. Refactor/retire those two endpoints in the same commit, then delete.
- `src/lib/research/{drain-status,census-sources,ingest}.ts` — importers only inside B1 (`drain-status` also feeds `src/lib/operator/postcode-refresh.ts`).
- `src/app/api/health/research/route.ts` — delete (or repoint health elsewhere) with the above refactor.
- `next.config.ts` — remove the 3 route bundles that ship `hermes/skills` to `/operator/research` (lines ~8-10).
- Runtime: `hermes/tools/research-runtime/**` (VPS queue worker + supervisor), `hermes/tools/meta-library-capture/**` (Meta Library scraper). Wired only via `infra/hermes/Dockerfile` (lines 24-31), `infra/hermes/main-wrapper.sh`, `infra/coolify/docker-compose.research.yml`. `worker/index.ts` does **not** depend on them.
- Skills (research-ops only): `hermes/skills/{blockwise-ad-collector,blockwise-ad-classifier,blockwise-agent-census,blockwise-coverage-auditor,blockwise-defect-investigator,blockwise-location-ad-search,blockwise-page-resolver,blockwise-operator-chat}`. NOTE `blockwise-agent-cleanup` / `blockwise-agent-reviewer` / `blockwise-artifact-packager` are cleanup/review skills — keep.
- Tests: `tests/research-engine/**`, `tests/ad-radar-accuracy-audit.test.mjs` (+`.ts`), `tests/research-inactive-purge.test.ts`
- Docs: `docs/research-engine/**` (README.md, env.md, operator-runbook.md), `docs/plans/2026-07-20-meta-capture-rebuild-model-cutover.md`, `research/**` (5× ad-radar-replacement md), `meta_ad_candidates/**` (image data)
- Tests that **reference** these routes and must be edited (not deleted): `tests/feature-surface-isolation.test.ts` (research routes list), `tests/operator-service-role-pages.test.ts` (research/content page snapshots)

### B2. Operator content-engine (blog / content-to-lead)

- Pages: `src/app/(operator)/operator/content-prompts/page.tsx`, `src/app/(operator)/operator/content-runs/page.tsx`, `src/app/(operator)/operator/content-runs/[id]/page.tsx`
- API routes: `src/app/api/operator/content-prompts/**`, `src/app/api/operator/content-runs/**` (approval, rerun, [id])
- Components: `src/components/operator/content-runs/**` (content-prompt-editor, content-run-console, content-run-review)
- Lib: `src/lib/content-engine/**` (contracts.ts, index.ts, queue.ts, repository.ts) — no external importers
- Tests: `tests/content-engine/**`
- Skills (blog generator suite — verify none are used by AdStudio before deleting): `hermes/skills/{blockwise-blog-editor,blockwise-blog-formatter,blockwise-blog-writer,blockwise-content-run-orchestrator,blockwise-content-strategist,blockwise-topic-researcher,blockwise-seo-schema-builder,blockwise-social-post-generator,blockwise-image-brief-writer,blockwise-image-generator,blockwise-image-reviewer}` — **verify** `blockwise-image-*` first: image generation may still serve AdStudio. Do not delete `blockwise-instant-form-generator` / `blockwise-lead-ad-generator` / `blockwise-page-builder` / `blockwise-model-router` / `blockwise-prompt-manager` / `blockwise-listing-scraper` without checking (lead/product surfaces).

### B3. Operator email console (mailbox UI)

- Page: `src/app/(operator)/operator/email/page.tsx`
- API routes: `src/app/api/operator/email/route.ts`, `src/app/api/operator/email/[id]/route.ts`
- Component: `src/components/operator/email-console.tsx`
- **Keep** `src/lib/operator/email-service.ts` — it has customer importers: `src/app/suburb/[postcode]/actions.ts` (`sendOperatorEmail`) and `src/lib/notify/demo-request-email.ts`. Delete the console/API/pages; keep the lib (or refactor customer paths off it first).
- Tests: `tests/operator-email-service.test.ts` — rewrite to cover the lib only, or keep as-is since lib stays.

### Referrer edits required (edit, not delete) in the same sweep

- `src/components/sidebar-nav.tsx` — drop `Email` and `Research Ops` links (lines ~61-62)
- `src/components/app/mobile-bottom-nav.tsx` — drop `/operator/email`, `/operator/research` (lines ~27, 31, 33)
- `next.config.ts` — research route bundles (B1)
- `tests/feature-surface-isolation.test.ts`, `tests/operator-service-role-pages.test.ts` — route lists
- `src/lib/features/route-availability.ts` — remove `/operator/research` + `/api/operator/research` feature-route entries (lines 9-10)

## (c) ALREADY GONE (verified — `node scripts/verify/hard-reset-static.mjs` passes)

The legacy AdStudio flat-clone system was deleted in Phase 1. The verifier
enforces zero legacy identifiers in `src`, `tests`, `scripts`, `trigger`,
`hermes/tools`; the only code hits for the legacy terms are inside the verifier
itself (self-excluded). Deleted paths include:

- `src/lib/adstudio/`: template-gallery/, reference-clone.ts, clone-generation.ts, clone-campaign.ts, clone-creative.ts, clone-regions.ts, region-edit.ts, rasterize-reference.ts, generate-template-campaign.ts, template-resolver.ts, template-preview.ts, creative-preview.ts, creative-export.ts, export-package.ts, export-render-storage.ts, generated-media.ts, generation-credits.ts, generation-error.ts, generation-lock.ts, live-workflow.ts, offers.ts, platform-rules.ts, scoring.ts, templates.ts, template-display.ts, readiness.ts, job-status.ts, clone-candidate-audit.ts, clone-quality-gate.ts, empty-campaign.ts, first-ad-input.ts, load-live-bundle.ts, layer-derivation.ts, magic-layers-config.mjs, outpaint-layout.ts, resolve-image-for-model.ts, smart-crop.ts, text-layers.ts, text-layer-state.ts, creative-library.ts, creative-revisions.ts
- `public/adstudio-samples`, `scripts/adstudio/{create-template.mjs, local-template-adapter.mjs}`, `scripts/build/rasterize-adstudio-samples.mjs`, `scripts/verify/adstudio-templates.mjs`, `hermes/skills/adstudio-template-builder`, `.github/codex/prompts/adstudio-template-integrator.md`, `mockups/qwen-adstudio-full-process-20260722`
- `src/app/api/adstudio/{jobs, creatives/[id]/edit, campaigns/route.ts, campaigns/[id]/draft, export-packages}`, `src/app/api/operator/template-trace`
- `src/components/adstudio/{ad-studio-workbench.tsx, new-ad-dialog.tsx, canvas/in-place-ad-editor.tsx}`

Remaining legacy-term hits are **docs/history only** (no code): `AGENTS.md`
(now rewritten), `.plan/template-trace-inspector.md`,
`docs/CLAUDE-CODE-PROMPT-STAGE2.md`, `docs/plans/2026-07-28-mobile-dashboards-spec.md`,
`docs/superpowers/specs/2026-07-15-adstudio-local-subscription-adapter-design.md`,
`docs/superpowers/specs/2026-07-27-progressive-onboarding-pricing-rollout-design.md`,
`docs/plans/2026-07-27-adstudio-magic-layers-editor.md`,
`supabase/migrations/202607150001_adstudio_fast_quality_profile.sql`
(applied migration — keep as history), `.claude-task-prompt.md`.

## (d) Recommended next delete commit (BW-D)

One commit, explicit paths:

1. **B1 research surface** (pages, 27 API routes, 4 components, 5 libs,
   `api/health/research`, `next.config.ts` edits, `tests/feature-surface-isolation` +
   `tests/operator-service-role-pages` edits, `tests/research-engine`,
   `tests/research-inactive-purge`, `tests/ad-radar-accuracy-audit.*`,
   `docs/research-engine`, `research/`, `meta_ad_candidates`,
   `docs/plans/2026-07-20-meta-capture-rebuild-model-cutover.md`) **plus** the
   `paid-service-watchdog` refactor off `src/lib/research/service.ts`.
2. **B2 content-engine** (3 pages, 6 API routes, 3 components,
   `src/lib/content-engine`, `tests/content-engine`, and the confirmed blog-only
   skills).
3. **B3 email console** (page, 2 API routes, email-console.tsx; keep
   `email-service.ts`), plus sidebar/mobile-nav referrer edits.

Then a follow-up commit for infra+runtime: `hermes/tools/research-runtime`,
`hermes/tools/meta-library-capture`, `infra/hermes/Dockerfile`,
`infra/hermes/main-wrapper.sh`, `infra/coolify/docker-compose.research.yml`,
and research-ops skills — this must be coordinated with the VPS deploy so the
supervisor process is stopped, not orphaned.

**Before deleting**: verify `hermes/skills/blockwise-image-*` and
`blockwise-listing-scraper` are not used by AdStudio/leads (see B2 note);
`src/lib/adstudio/listing-extract.ts` imports listing-scraper output types, so
the scraper stays until that customer path is checked.
