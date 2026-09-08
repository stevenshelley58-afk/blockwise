# Blockwise engineering rules

Read /projects/frank/docs/standards/engineering-rules.md first.
This file adds Blockwise-specific boundaries. The sole current procedure index
is [docs/README.md](docs/README.md).

Blockwise is the customer product: customers choose Frank-built layered
template packs, edit ads, save Feed/Story renders, export, publish through
gated Meta workflows, and manage campaigns/leads/billing. Frank supplies the generation interface; Hermes executes generation. The deleted flat-clone system and references to its old scripts are
not current architecture.

## Product positioning and copy

Blockwise is an app that helps real estate agents get leads. It is not an app
for selling houses.

In product explanations, marketing copy and video scripts, lead with getting
leads. Explain ad creation, campaign management and reporting as tools that
support lead generation. Do not frame selling houses as Blockwise's purpose
or main promise, and do not imply guaranteed leads or sales.

## Safety and boundaries

- Preserve workspace isolation: every workspace query and storage path is
  scoped, and RLS remains enabled.
- Provider tokens live in `private.provider_token_vault`, accessed only through
  service-role `public.provider_token_vault_*` RPCs; never expose the private schema.
- Schema changes need tested migrations; verify the target and a recoverable
  backup before risky data changes. Preserve non-empty retired data in an archive.
- Hermes research/agent runtime and data remain separate from Blockwise.


## UI and design

Preserve the current UI and `DESIGN.md` authority. Customer UI uses the
existing shadcn/Tailwind token bridge and `src/components/ui/`; operator UI
keeps its existing CSS shell. Reuse existing navigation metadata and
components; do not create a parallel design system.

## Single application authority

- `/projects/blockwise` on `main`, tracking `origin/main`, is the sole maintained
  application source. Production must serve that exact verified revision.
- Feature branches and design previews are unfinished work, not alternate
  application authorities. Preserve them; integrate accepted changes into
  `main` before release. Never deploy the customer app from a feature checkout.
- Release only through `scripts/vps/product-release.sh`, using a clean immutable
  checkout under `/srv/blockwise/releases/product/<full-sha>`. The release guard
  must verify canonical source, remote main, immutable source, image and live
  compiled revision. Do not bypass the guard with ad-hoc Compose commands.
- Rollbacks are the explicit exception: use a retained verified release, record
  the incident, and reconcile `main` before the next normal release.
- Historical branches under `archive/` preserve unreleased work and provenance;
  they are not deployment candidates. Do not merge them wholesale to remove
  divergence or rewrite their published history.

## Verification and release

Use [production readiness](docs/runbooks/production-readiness.md) for required
repository checks, controlled VPS acceptance and compiled provenance.
Keep provider writes disabled until their explicit product gate passes.
