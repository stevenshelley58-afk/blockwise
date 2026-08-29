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
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO authenticated',
      protected_table.schema_name,
      protected_table.table_name
    );
  END LOOP;
END $$;
