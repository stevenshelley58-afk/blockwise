# Blockwise documentation

This is the sole current Blockwise documentation index. Read
`/projects/frank/docs/standards/engineering-rules.md` and
[AGENTS.md](../AGENTS.md) first. Older worktree and branch documents are
snapshots, not alternate current rules.

The application has one source authority: `/projects/blockwise` on `main`,
tracking `origin/main`. Normal releases use the guarded single-authority procedure
in production readiness below. Isolated previews and archived work are not
alternate production versions.

## Current authorities

- [Architecture overview](architecture/overview.md)
- [Product map](architecture/product-map.md)
- [Extension guide](architecture/extension-guide.md)
- [Production verification and release](runbooks/production-readiness.md)
- [VPS access](runbooks/vps-ssh.md)
- [Rollback](runbooks/rollback.md)
- [Product worker deployment](runbooks/vps-worker-deploy.md)
- [Client-data isolation](security/client-data-isolation.md)
- [Product-agent safety](security/agent-safety.md)
- [Transactional email outbox](runbooks/transactional-email.md)
- [Postcode outreach drafts and sample previews](runbooks/postcode-outreach.md)

The maintained production target is the self-hosted VPS product stack behind
Caddy. Verify its current revision through the production runbook; an old
release record is not a permanently current version.

The single cross-system template-generation policy and operator guide is
`/projects/frank/docs/AD_TEMPLATE_GENERATOR.md`. Blockwise consumes that
contract and does not keep another copy of its score, review or approval rules.

## Component references

[Hermes source components](../hermes/README.md) describe skills and tools,
- [Ad Radar worker runbook](../hermes/tools/research-runtime/AD_RADAR_RUNBOOK.md)
not a second runtime or proof that a component is enabled. Component skills,
infra and operations READMEs apply only to their named component and cannot
override the shared rules or the current release guides.

Files under `docs/content/guides/` are customer education, not operational
release authority. Keep published resource files aligned with their source
guides. Third-party licence text is retained unchanged.

## Plans and historical evidence

- [8 September single application authority](releases/2026-09-08-single-authority.md)

- [8 September lead-management baseline](plans/2026-09-08-lead-management-baseline.md)

- [8 September documentation audit](releases/2026-09-08-docs-alignment.md)
- [8 September customer UX swarm lane 3 (draft evidence)](releases/2026-09-08-customer-ux-swarm.md)
- [8 September mobile customer release](releases/2026-09-08-mobile-customer-shell.md)
- [7 September postcode outreach release](releases/2026-09-07-postcode-outreach.md)
- [7 September guides editorial redesign](releases/2026-09-07-guides-editorial.md)
- [7 September pricing race-recovery release](releases/2026-09-07-pricing-race-recovery.md)
- [7 September pricing release](releases/2026-09-07-pricing.md)
- [6 September template-editor release](releases/2026-09-06-template-editor.md)
- [OSS migration record](runbooks/oss-product-migration.md)

Dated plans, submission records, work logs and sections marked historical record
the intent or evidence at that time. They do not prove current deployment,
provider approval, SMTP, billing, migration, template quality or customer-data
readiness. Retired Vercel and managed-Supabase procedures are not fallback
deployment instructions. Plans are proposals unless implementation and current
verification are separately recorded.

## Design previews

- [Reporting loop without playback button](releases/2026-09-08-homepage-reporting-no-pause.md) - automatic chart-to-email loop with only the three content selectors visible.

- [Reporting chart-to-email loop](releases/2026-09-08-homepage-reporting-loop.md) - completion-driven crossfade, repeating chart reveal and accessible playback controls.

- [Visual campaign controls](releases/2026-09-08-homepage-campaign-controls.md) - interactive creative, budget, campaign and email controls; verified combined preview.

- [Pricing FAQ on homepage](releases/2026-09-08-homepage-pricing-faq.md) - six collapsible categories and all 15 current pricing questions.

- [Reporting conversion update](releases/2026-09-08-homepage-reporting-conversion.md) - clearer reporting outcome, visible trial action and preview release evidence.
- [Reporting email selector](releases/2026-09-08-homepage-reporting-email.md) - 7-day, 30-day and inert email preview states with sanitized sample provenance.

- [Approved workflow copy](releases/2026-09-08-homepage-workflow-copy.md) — exact two-line heading and subheading, responsive checks and preview release evidence.

- [Homepage concept](design/homepage-concept.md) — isolated mobile/desktop mockup; not a production homepage release.
- [Reporting chart axis fix](releases/2026-09-07-homepage-reporting-axis.md) — complete point labels on desktop with a readable narrow-screen month scale.
- [Motion-led reporting graph](releases/2026-09-07-homepage-reporting-motion.md) — full-width line graph, minimal copy and smooth reporting interactions.
- [Minimal reporting revision](releases/2026-09-07-homepage-reporting-minimal.md) — line graph, one dashboard and 73% fewer words.
- [Homepage reporting redesign](releases/2026-09-07-homepage-reporting.md) — personal dashboard, scheduled-email concept and release evidence.
- [Homepage FAQ preview update](releases/2026-09-07-homepage-faq.md) — friendlier copy, account setup and data ownership.
- [Homepage preview evidence](releases/2026-09-06-homepage-concept.md) — revision, browser checks and reapplication instructions.
