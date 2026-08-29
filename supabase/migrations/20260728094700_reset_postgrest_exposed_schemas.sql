-- Research is private to the VPS. Customer Supabase exposes app schemas only.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
