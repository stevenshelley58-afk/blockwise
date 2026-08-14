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

Useful flags: `--pack-id`, `--build-id`, `--nonce`, `--fixture <path>`,
`--sig-file <path>`, `--pack-sha256 <hex>`.
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

### Importing a real factory pack (signed)

Ed25519 verification is **live** in `src/lib/adstudio/import-pack.ts`
(step 8, `verifyPackSignature`) whenever `FRANK_PACK_PUBLIC_KEY` is set —
the lowercase-hex SPKI DER public key of the Frank factory. The factory
writes a `pack.json.sig` sidecar next to every `pack.json`; pass it with
`--sig-file` so the real signature (and the factory's `packSha256`) travels
through the import request instead of the fixture placeholder:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/adstudio/import-fixture-pack.mjs --yes \
  --fixture <pack.json> --sig-file <pack.json.sig> --pack-sha256 <hex>
```

- `--sig-file <pack.json.sig>` — the factory's sidecar JSON
  (`{algorithm, keyId, publicKey, signature, packSha256, dev}`). Its
  `signature` field becomes `ImportRequest.signature` and its `packSha256`
  is used unless `--pack-sha256` overrides it.
- `--pack-sha256 <hex>` — explicit pack hash override. Must be the
  canonical-JSON SHA-256 (`sha256Hex`); the factory's `pack.json.sha256`
  matches this, but a raw `sha256sum` of the pretty-printed file does NOT.
- Without `--sig-file` the script falls back to the placeholder signature.
  That still works on the local `fetchPack` seed path when
  `FRANK_PACK_PUBLIC_KEY` is unset (the documented test/local exception),
  but is **rejected** (`signature_rejected`) if the key is set — import
  real factory packs with `--sig-file`.

The internal server route
(`src/app/api/internal/adstudio/template-packs/import/route.ts`) refuses
imports when `FRANK_PACK_PUBLIC_KEY` is unset (`missing_public_key`); the
injected `fetchPack` path is the only exception. Set `FRANK_PACK_PUBLIC_KEY`
in the Vercel project env (the factory's public key, lowercase hex SPKI DER)
before delivering real Frank packs through the production route.

### Signature / FRANK_PACK_PUBLIC_KEY

The importer verifies the Ed25519 signature over the canonical pack JSON on
every import where `FRANK_PACK_PUBLIC_KEY` is set — including the
placeholder-signature fixture path, which then fails with
`signature_rejected`. The key guard (`missing_public_key`) fires before any
network fetch on the production (live-fetch) route. This script's
`fetchPack` injection is the documented test/local exception: when the key
is unset the signature check is skipped because the operator vouches for
the fixture bytes on disk. Point `FRANK_PACK_PUBLIC_KEY` at the factory
public key to exercise real verification from the seed path.
