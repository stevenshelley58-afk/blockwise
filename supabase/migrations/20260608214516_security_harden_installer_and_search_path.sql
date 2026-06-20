-- Recovered verbatim from the production migration ledger (schema_migrations.statements).
-- Applied out-of-band to prod as version 20260608214516; restored to source control here.

-- Lock down the policy-installer: it rewrites RLS policies as table owner and must not be
-- callable by anonymous or signed-in users via /rest/v1/rpc. Keep service_role/postgres.
REVOKE EXECUTE ON FUNCTION public.adstudio_install_workspace_policies(regclass) FROM PUBLIC, anon, authenticated;

-- Pin search_path on the research helper functions (fixes function_search_path_mutable).
-- These reference only built-ins, so an empty search_path is safe and behaviour-preserving.
ALTER FUNCTION research.set_updated_at() SET search_path = '';
ALTER FUNCTION research.jsonb_int(jsonb, text[], integer) SET search_path = '';
ALTER FUNCTION research.valid_external_ad_id(text) SET search_path = '';
ALTER FUNCTION research.creative_is_real_estate(jsonb, text, text) SET search_path = '';
