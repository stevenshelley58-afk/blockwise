# Product backup and restore verification

The daily product backup writes only to /srv/blockwise/product/backups/encrypted.
It captures a PostgreSQL custom dump, role globals, row-count metadata, and a
tar archive of the product Storage volume. Each artifact is encrypted with the
host-held age key /etc/blockwise/product-backup.agekey before temporary
plaintext is removed. The key is outside Git and the backup directory.

Retention targets only timestamped directories older than approximately 90 days beneath this
new designated directory. Existing /srv/blockwise/backups/product snapshots are
not touched.

Every run verifies checksums, age decryption, the extracted Storage file checksums,
and an actual restore into a disposable PostgreSQL 17 container on an isolated
Docker network. It then compares representative counts for workspaces, job_queue,
and email_outbox with the captured metadata. Auth roles and application behavior
are not exercised. Storage is read without a filesystem snapshot, so its
consistency is best effort while writes are active.

Install as root with scripts/vps/install-product-backup-timer.sh. No product
services are stopped and no backup is uploaded. The current implementation has
no configured off-host destination, so VPS loss protection remains a deployment
prerequisite. A full DR rehearsal still requires Auth and application
reconciliation, plus a storage snapshot strategy if stronger consistency is
needed.
