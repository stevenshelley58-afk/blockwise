# Architecture overview

Production is the self-hosted VPS Compose stack behind Caddy: Next standalone app, PostgreSQL, PostgREST, GoTrue, Storage API, and optional Realtime. The durable worker is profile-gated and must stay omitted while `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`. `@supabase/supabase-js` is a protocol client pointed at the product Caddy origin.

The live revision and health evidence are recorded in the
[production-readiness runbook](../runbooks/production-readiness.md). Health
readiness is not proof that every external integration is accepted or enabled.

Application layers are route pages in `src/app`, reusable UI and AdStudio pieces in `src/components`, data/auth/provider boundaries in `src/lib`, niche configuration in `src/config/niche`, layered template contracts in `packages/`, and SQL/deployment work under `supabase/`, `infra/`, and `scripts/vps/`.

Keep customer UI on the existing shadcn/Tailwind token bridge and operator UI on its existing CSS system. Do not modify `DESIGN.md` tokens as part of ordinary feature work. Release acceptance is the controlled VPS target, not localhost or Vercel Preview. DNS, SMTP, OAuth, provider writes, billing, migrations, and worker activation are independent gates.
