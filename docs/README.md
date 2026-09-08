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

The maintained production target is the self-hosted VPS product stack behind
Caddy. Verify its current revision through the production runbook; an old
release record is not a permanently current version.

The single cross-system template-generation policy and operator guide is
`/projects/frank/docs/AD_TEMPLATE_GENERATOR.md`. Blockwise consumes that
contract and does not keep another copy of its score, review or approval rules.

## Component references

[Hermes source components](../hermes/README.md) describe skills and tools,
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
- [6 September template-editor release](releases/2026-09-06-template-editor.md)
- [OSS migration record](runbooks/oss-product-migration.md)

Dated plans, submission records, work logs and sections marked historical record
the intent or evidence at that time. They do not prove current deployment,
provider approval, SMTP, billing, migration, template quality or customer-data
readiness. Retired Vercel and managed-Supabase procedures are not fallback
deployment instructions. Plans are proposals unless implementation and current
verification are separately recorded.
