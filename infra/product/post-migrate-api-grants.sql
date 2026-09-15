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
        'video_order_events',
        -- video_orders as well. An order carries its own price, tax treatment,
        -- offer snapshot and due dates, and every one of those is derived on the
        -- server. Granting the browser role INSERT here let a customer create an
        -- order directly and choose the amount they owed; RLS alone did not stop
        -- it, because the row they insert is legitimately in their own
        -- workspace. Customers read their orders, and server code writes them.
        'video_orders'
      )
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO authenticated',
      protected_table.schema_name,
      protected_table.table_name
    );
  END LOOP;
END $$;

-- The exclusion above only declines to grant; it cannot undo a grant that a
-- migration already issued. A migration that grants a browser role write access
-- and a later script that merely skips the table leaves that access in place,
-- which is how customers ended up holding INSERT on video_orders and could
-- create an order directly, choosing the amount they owed. Revoke explicitly.
DO $$
DECLARE
  server_only record;
BEGIN
  FOR server_only IN
    SELECT namespace.nspname AS schema_name, class.relname AS table_name
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p')
      AND class.relname IN (
        'video_assets',
        'video_brief_versions',
        'video_payment_attempts',
        'video_order_events',
        'video_orders'
      )
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM authenticated',
      server_only.schema_name,
      server_only.table_name
    );
  END LOOP;
END $$;

-- video_orders stays readable: a customer reads their own order through RLS.
-- Everything that writes it is server code holding the service role.
