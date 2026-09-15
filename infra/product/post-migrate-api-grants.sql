-- Reproduce the self-hosted PostgREST role boundary without broadly granting
-- browser roles access to unprotected tables. service_role is the privileged
-- server credential; authenticated receives DML only where RLS is enabled,
-- so table policies remain the mandatory authorization boundary. Anonymous
-- access stays migration-specific and is never expanded here.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

DO $$
DECLARE
  protected_table record;
BEGIN
  FOR protected_table IN
    SELECT namespace.nspname AS schema_name, class.relname AS table_name
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p')
      AND class.relrowsecurity
      -- Outreach contains private CRM data and is server-only, even with RLS.
      -- Ad Builder Video keeps its internal production record server-only too:
      -- storage references, private briefs, operator-only assets, payment
      -- attempts and the append-only audit trail are reached through
      -- authenticated API routes that enforce workspace scope explicitly.
      AND class.relname NOT IN (
        'outreach_area_snapshots',
        'outreach_prospects',
        'outreach_campaign_drafts',
        'video_assets',
        'video_brief_versions',
        'video_payment_attempts',
        'video_order_events'
      )
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO authenticated',
      protected_table.schema_name,
      protected_table.table_name
    );
  END LOOP;
END $$;
