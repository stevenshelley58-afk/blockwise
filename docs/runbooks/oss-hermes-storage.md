# Hermes OSS research media storage

Hermes research media is stored in an isolated stack. The research Postgres
database remains the system of record for research state; a separate
`research-storage-db` contains only Supabase Storage metadata; and the
Storage API file backend writes to a dedicated named volume. Nothing in this
stack uses the customer product database or product storage volume.

The compose stack pins Postgres, PostgREST, Storage API
`v1.60.4@sha256:c8eb9858eafec891a97c27125470aaad54703c3f4eb4d55ca7f1bf6c6411febf`
(the immutable multi-architecture manifest digest), and Caddy images. The
file backend is the mature default for this single-VPS deployment: it keeps
the bytes in a dedicated named volume and avoids introducing a beta object
store with no redundancy. It is still single-disk data, so the backup and
restore checks below are mandatory.

## Network and URL contracts

`research-storage` has no host ports. Hermes reaches the
authenticated Storage API through the private `research` Docker network at
`http://blockwise-research-gateway:3000/storage/v1`.

The Storage API uses its mature file backend at `/var/lib/storage`; the
`research-storage-data` named volume is the only blob volume. `STORAGE_PUBLIC_URL`
is set to the controlled external media prefix and
`REQUEST_ALLOW_X_FORWARDED_PATH=true` keeps generated paths correct behind the
two Caddy layers.

Customer rendering uses the explicitly public route:

```
https://hermes.blockwise.sale/research-media/storage/v1/object/public/research-ad-creatives/<path>
```

The public media gateway forwards only
`/storage/v1/object/public/*`; list, upload, bucket, signed URL, and admin
endpoints return 404 there. The bucket is intentionally public because the
customer ad-radar is a public research showcase; this route contains captured
advertising media, not customer uploads or credentials. Keep customer upload
objects in the product storage service and never add a product volume mount to
the research compose file.

`HERMES_CUSTOMER_SUPABASE_URL` remains the customer read-model destination.
It is not a research-media endpoint. `HERMES_RESEARCH_STORAGE_URL` and its
separate service credential are mandatory for Hermes media writes. Do not set
either storage URL to a managed Supabase host. The runtime must fail closed if
the dedicated URL or storage credential is absent.

## Secrets and bootstrap

Generate independent, URL-safe values for:

- `HERMES_RESEARCH_STORAGE_DB_PASSWORD`
- `HERMES_RESEARCH_STORAGE_JWT_SECRET`
- `HERMES_RESEARCH_STORAGE_ANON_KEY`
- `HERMES_RESEARCH_STORAGE_SERVICE_KEY`

Do not place real values in the repository or image layers. The
`research-storage-db` and `research-storage-data` named volumes are durable
and must be included in the VPS backup inventory.

Before starting Hermes, render and inspect the compose configuration, then
start the storage dependencies and verify their healthchecks:

```sh
docker compose --env-file /srv/blockwise/research/.env \
  -f infra/coolify/docker-compose.research.yml config --quiet
docker compose --env-file /srv/blockwise/research/.env \
  -f infra/coolify/docker-compose.research.yml up -d \
  research-storage-db research-storage-rest research-storage research-media-gateway
```

Create `research-ad-creatives` through the private Storage API using the
Hermes service key, then verify one upload and one public GET through the
`research-media` route. Do not run a migration or move the existing
29,508,724,666 bytes as part of this change; that is a separate, operator-led
cutover with a verified source manifest and rollback plan.

## Backups and restore

`research-storage-backup` writes compressed, checksummed Storage metadata
dumps to `/opt/blockwise-backups/research-storage`. The
`research-storage-data` volume is the authoritative bytes and must be
snapshotted or copied by the host backup job with the metadata dump. A
metadata-only restore is incomplete. Verify checksums before restore and
restore metadata first, then reconcile every object path and byte count
against the source manifest.

The single-disk file volume has no replica. If its disk is lost, restore the
`research-storage-data` volume backup and matching metadata dump; never point
Storage API at the product storage volume as a shortcut.
