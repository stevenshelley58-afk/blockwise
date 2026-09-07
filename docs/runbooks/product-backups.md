# Product backup and restore verification

The daily product backup writes only to /srv/blockwise/product/backups/encrypted.
It captures a PostgreSQL custom dump, role globals, row-count metadata, and a
tar archive of the product Storage volume. Each artifact is encrypted with the
host-held age key /etc/blockwise/product-backup.agekey before temporary
plaintext is removed. The key is outside Git and the backup directory.

Retention removes only timestamped directories older than 90 days beneath this
new designated directory. Existing /srv/blockwise/backups/product snapshots are
not touched.

Every run verifies checksums, age decryption, pg_restore --list, and the
Storage archive. This is a restore-format check, not a full database restore
rehearsal. Storage is read without a filesystem snapshot, so its consistency is
best effort while writes are active.

Install as root with scripts/vps/install-product-backup-timer.sh. No product
services are stopped and no backup is uploaded. A full DR rehearsal still
requires an isolated PostgreSQL restore plus Auth and Storage reconciliation.
