# Ad Studio scripts

Dev/admin helpers for the Blockwise Ad Studio.

## `import-fixture-pack.mjs` — seed the template-pack gallery

Imports the fixture TemplatePack
(`tests/fixtures/template-pack/minimal-feed-story.json`) into a Blockwise
Supabase project so the Ad Studio gallery is **not empty** on local/preview
deployments. The gallery read model (`src/lib/adstudio/pack-gallery.ts`)
reads `ad_template_packs`; this script populates it through the **same signed
import pipeline** the internal API route uses
(`src/lib/adstudio/import-pack.ts`), but with the test/local `fetchPack`
injection point — pack bytes come from the fixture JSON on disk, no live
Frank URL required, and the HTTPS + origin allowlist is skipped because the
operator vouches for the source.

**Pack format note:** today the pack format is a JSON document (canonical-JSON
hashed), not a zip container — the fixture JSON *is* the pack. The script
reuses the exact helpers the import tests use (`sha256Hex` from
`ad-template-pack-contract`, `fetchPack` injection).

### Prerequisites

- Node 22 (native TS type-stripping; same runtime `npm test` uses).
- Service-role credential for the **target** project (local or preview):
  - `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
  - `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY` (legacy)

Secrets come from the environment only — nothing is written to the repo
(`.gitignore` already covers `.env*`). Never commit a service-role key.

### Usage

```bash
# Plan only — validates env + fixture, writes nothing
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/adstudio/import-fixture-pack.mjs --dry-run

# Actually import (requires the explicit --yes)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/adstudio/import-fixture-pack.mjs --yes

node scripts/adstudio/import-fixture-pack.mjs --help   # full flag list
```

Useful flags: `--pack-id`, `--build-id`, `--nonce`, `--fixture <path>`.
Re-running the same pack hash is idempotent — you get a `replayed` receipt
and no duplicate rows.

### Against local Supabase

```bash
supabase start                       # local stack + migrations applied
# point the script at the local project:
node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/adstudio/import-fixture-pack.mjs --yes
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
and the local service key (from `supabase status -o env`, `SERVICE_ROLE_KEY`)
as `SUPABASE_SERVICE_ROLE_KEY=` (or `SUPABASE_SECRET_KEY=`).
The import tables come from
`supabase/migrations/20260812150000_ad_template_pack_import.sql`.

### Against a Vercel preview deployment

The preview app reads its Supabase project via its own env; run the script
from a shell with that project's service-role credential exported — **do not
commit them**:

```bash
export SUPABASE_URL=https://<preview-project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # or SUPABASE_SECRET_KEY
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/adstudio/import-fixture-pack.mjs --yes
```

Then open the preview URL — the gallery lists the imported pack
(`classification.label` = "fixture" is the display name).

### What it writes

`ad_import_receipts`, `ad_import_nonces`, `ad_template_packs`,
`ad_template_pack_versions`, `ad_template_assets` — the same tables the
internal import route (`src/app/api/internal/adstudio/template-packs/import/route.ts`)
writes. `ad_template_packs` is global (shared by every workspace), so the
seed shows up for all workspaces on that project.

### Signature / FRANK_PACK_PUBLIC_KEY

The script sends the fixture's placeholder signature
(`fixture-ed25519-signature-placeholder`). Real Ed25519 verification is a
Phase 5 placeholder in `import-pack.ts` (commented out), so no key is
required today. When verification lands it will be keyed by the Frank public
key (env `FRANK_PACK_PUBLIC_KEY`) and this seed path will need a fixture
signed with the matching private key.
