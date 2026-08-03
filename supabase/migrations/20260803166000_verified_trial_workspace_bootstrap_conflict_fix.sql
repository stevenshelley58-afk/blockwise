-- PL/pgSQL output columns are variables. Name the constraints explicitly so
-- workspace bootstrap cannot confuse the workspace_id output with table
-- columns while handling idempotent inserts.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.bootstrap_verified_trial_workspace(uuid)'::regprocedure
  ) into v_definition;

  v_definition := replace(
    v_definition,
    'on conflict (workspace_id, profile_id) do nothing',
    'on conflict on constraint workspace_members_pkey do nothing'
  );
  v_definition := replace(
    v_definition,
    'on conflict (workspace_id) do nothing',
    'on conflict on constraint customer_activations_pkey do nothing'
  );

  if lower(v_definition) like '%on conflict (workspace_id%' then
    raise exception 'Could not harden bootstrap_verified_trial_workspace conflict targets';
  end if;

  execute v_definition;
end;
$migration$;
