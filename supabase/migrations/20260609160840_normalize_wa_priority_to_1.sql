-- Recovered verbatim from the production migration ledger (schema_migrations.statements).
-- Applied out-of-band to prod as version 20260609160840; restored to source control here.

UPDATE research.refresh_policies
SET priority = 1, next_refresh_at = now()
WHERE state = 'WA';
