# Ad DB delivery

Status: implementation in progress; no migration in this document is applied to production.

## Canonical contract

The research database is the canonical read model for archived ad evidence. An ad is displayable only from persisted, verified media bytes; CDN/source URLs are provenance and never a display fallback. Each ad scan is page-ID scoped, country/filter scoped, idempotent, and preserves raw evidence for offline diagnosis.

Collection flow: page scan -> ad snapshot/creative -> pending media source -> archived verified bytes -> customer read projection.

## Lifecycle and coverage

- A complete comparable scan means one numeric advertiser page, AU, activeStatus=all, successful pagination exhaustion, and a distinct completed run.
- Partial, unknown, mismatched-page, older out-of-order, or unsupported-scope scans are absence of evidence. They cannot advance misses or declare a page healthy.
- Two distinct complete comparable misses may mark an active ad inactive. Historical/all-status reappearance is not active evidence and cannot reactivate it.
- Retain inactive ads, snapshots, media, and evidence permanently. The legacy purge RPC returns an archive-retention no-op.

## Cost defaults

- AI/model calls default to zero.
- ScrapingBee requires an authenticated, fresh balance verification, DB budget row, and worst-case ceiling before queueing. No verification means no queue.
- Budget reservation/settlement durability belongs to migration 009; 008 intentionally does not spend or reserve credits.

## Cadence

- Priority coverage: weekly.
- Active pages: fortnightly.
- Confirmed zero-ad pages: monthly.
- Unknown/partial/failing pages: backoff and investigation; they are never treated as zero.

## Delivery gates

1. Parent reviews the migration diff and the existing backup receipt at /srv/blockwise/backups/research/ad-db-prebuild-20260905T1545Z.dump.
2. Run the isolated behavioural SQL test before any live apply.
3. Apply 008 only through the reviewed research migration path, then verify RPC permissions and retention no-op.
4. Deploy committed runtime from the actual deployment checkout (/projects/blockwise / /opt/blockwise), not merely this working checkout.
5. Run a bounded explicit pilot only; never start the generic supervisor against historical queues.

