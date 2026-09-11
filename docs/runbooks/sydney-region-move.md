# Moving Blockwise to an Australian region

The origin is in Kuala Lumpur while the customer base is Australian. Every
uncached dynamic request crosses Sydney to Kuala Lumpur, and that distance is
the largest remaining latency cost after the Cloudflare work. This records the
move: what has to travel, what blocks it, and the order to do it in.

Nothing here has been executed. It is a prepared plan with the unknowns already
resolved, so the move is mechanical once a target box exists.

## Why this is worth doing

Measured on the current host: the app itself answers a prerendered page in about
36 ms and a Supabase query in 2-5 ms, because the database shares a Docker
network with the app. The cost is distance, not compute. Cloudflare now
terminates the connection in Australia, but an uncached dynamic request still
travels Sydney to Kuala Lumpur and back.

## What actually has to move

Small numbers, which is what makes this tractable.

| Item | Size | Notes |
|---|---|---|
| Postgres database | 41 MB | Covered by the daily encrypted backup |
| Object storage volume | 503 MB | Covered by the same backup (512 MB `storage.tar.gz.age`) |
| Product stack RAM | ~550 MB | 7 containers, near-idle |
| Supabase Postgres (`supabase_db_Blockwise`) | separate | exists for Hermes/research, not the product |
| Product edge Caddy | config only | `infra/product/Caddyfile` |

State is roughly 544 MB, and all of it is already captured by the daily
encrypted backup. This is a lift, not a migration project.

## The one blocker: the Ad DB is not reachable off-host

`AD_DB_API_URL=http://172.16.1.1:9119` is served by Hermes **on this VPS**, on
the `frank` Docker bridge. It is therefore reachable only from this host.
`hermes.blockwise.sale` resolves to this VPS but nothing serves it publicly
(verified: the request returns 000), so there is no existing HTTPS path.

A moved product app cannot reach that address. Pick one:

1. **Public HTTPS endpoint for the Ad DB** (least moving parts). Terminate TLS at
   Frank's edge for a hostname such as `ad-db.blockwise.sale`, then set
   `AD_DB_API_URL` to it. Requires the same `TRUSTED_PROXY_RANGES`/client-IP
   care already applied, and the bearer token must stay server-side.
2. **WireGuard link** between Sydney and this host, then point `AD_DB_API_URL` at
   the tunnel address. No public listener, but a tunnel to operate and monitor.

Option 1 is closer to how everything else already works and is the recommended
default. Do not expose port 9119 directly to the internet.

## Backups already cover both halves

A daily encrypted backup runs at 03:15 UTC: `blockwise-product-backup.timer`
invokes `/usr/local/libexec/blockwise-product-encrypted-backup`, which dumps
Postgres plus globals and row counts, archives the object storage volume, hashes
every stored file, encrypts each artefact with `age`, verifies the result, and
applies 90-day retention. The 2026-09-11 run holds a 512 MB
`storage.tar.gz.age` beside the database dump, so objects are covered.

Be careful which script you trust here. `scripts/vps/product-backup.sh` in this
repository is an ad-hoc database-only helper and is **not** the scheduled job;
reasoning about backup coverage from the repo alone understates it. Check the
deployed unit.

One genuine caveat, recorded by the backup's own METADATA as
`asset_consistency=filesystem-read-no-snapshot`: objects are read while the
service is live, so a run during active writes can pair a database row with a
newer or older object. For a move, take the backup in a quiet window and compare
the restored object count against `storage.objects` before cutting over.

Rehearsing the restore still matters. The archive is only proven usable once
extracted: 1029 files extracted cleanly and a spot-checked object matched the
original byte for byte at the time of writing.

## Order of operations

1. **Rehearse a restore** from the existing encrypted backup (above).
2. **Provision the target** in a Sydney region. The stack idles under 1 GB RAM
   and needs ~1 GB of disk for state plus images; size for build headroom and
   log retention rather than steady-state.
3. **Recreate the host layout.** `scripts/vps/product-release.sh` hard-codes
   `/projects/blockwise` (canonical source) and `/srv/blockwise/{releases,
   product,backups}`. Create those paths, clone the repo to `/projects/blockwise`
   on `main`, and place the protected env at `/srv/blockwise/product/.env`
   (mode 600). Copy it over an encrypted channel; never through git.
4. **Recreate the systemd units**: `blockwise-autodeploy` (watcher, oneshot,
   `Environment=HOME=/root`), `blockwise-product-backup`,
   `blockwise-email-outbox-drain`, `blockwise-cleanup-checkouts`. The autodeploy
   unit reads `/usr/local/sbin/blockwise-autodeploy`; copy that too.
5. **Restore state**: database from `database.dump` plus `globals.sql`, then the
   storage archive into a fresh `blockwise-product-storage-data` volume. Compare
   against `row-counts.json` from the source backup.
6. **Resolve the Ad DB dependency** (above) and set `AD_DB_API_URL`.
7. **Bring the stack up** on the new host with `product-release.sh --prepare`
   then `--deploy`, before any DNS change.
8. **Cut DNS over.** Update the `A` record for `blockwise.sale` to the new IP.
   Both hosts serve during the TTL window, so keep the old one running.
9. **Re-verify the edge chain.** `TRUSTED_PROXY_RANGES` must match wherever the
   edge that fronts the new host actually runs. This is the failure mode that
   already bit once: a stale value silently collapses every customer onto one
   IP for rate limiting and audit attribution, with no error anywhere.
10. **Retire the old host** only after a full day of healthy traffic.

## Verification, in order

- `product-row-counts.sh` output matches the source backup exactly.
- Object count in the restored volume matches `storage.objects`.
- `curl -s https://blockwise.sale/api/health` reports the new revision.
- A real signed-in session works: log in and load `/self-serve`, `/ad-studio`,
  `/leads`, `/settings`.
- Client IP attribution is correct end to end. Substitute a header-capturing
  listener for `product-app` and confirm `X-Blockwise-Client-IP`,
  `X-Forwarded-For[0]` and `X-Real-IP` all equal the true client address.
- `AD_DB_API_URL` reachable from the app container, and the research/ad-radar
  surfaces still return data.

## Risks specific to this move

- **The Ad DB dependency** is the only cross-system coupling. It is not
  optional: research and ad-radar surfaces break without it.
- **`hermes.blockwise.sale`** points at the current host and serves nothing
  publicly today. If option 1 is chosen, this is the hostname to make real.
- **Cloudflare cutover**: the apex is now proxied, so DNS changes propagate
  behind the proxy. Verify against the origin directly with
  `curl --resolve blockwise.sale:443:<origin-ip>` as well as through the edge.
- **Two hosts serving concurrently** during the TTL window each have their own
  database. Do not let both write: the old host must stop serving before the new
  one accepts traffic, or accept that writes during the window are split.
