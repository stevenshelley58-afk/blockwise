-- Customer operations provider/aggregate matrix and outbox privilege boundary.
--
-- This is a forward-only repair migration. The previously published
-- operations migrations remain immutable. Existing rows are checked before
-- adding the composite constraint so an unexpected invalid pairing fails the
-- migration loudly instead of being silently reclassified.
--
-- Rollback: do not reverse this migration in place after deployment. If the
-- operations contract is retired, first freeze source writers and archive
-- current outbox rows under a run id, then add a later forward migration only
-- after the archive has been verified. Re-granting direct DML is prohibited.

begin;

do $$
declare
  invalid_count integer;
begin
  select count(*)::integer into invalid_count
  from public.ops_projection_outbox
  where not (
    (provider = 'mautic' and aggregate_type in ('contact', 'lifecycle'))
    or (provider = 'chatwoot' and aggregate_type in ('enquiry', 'support'))
  );
  if invalid_count > 0 then
    raise exception 'cannot enforce operations provider/aggregate matrix: % invalid rows', invalid_count
      using errcode = 'check_violation';
  end if;
end;
$$;

alter table public.ops_projection_outbox
  add constraint ops_projection_provider_aggregate_check check (
    (provider = 'mautic' and aggregate_type in ('contact', 'lifecycle'))
    or (provider = 'chatwoot' and aggregate_type in ('enquiry', 'support'))
  );

-- Hermes uses the constrained SECURITY DEFINER RPCs for all mutation and
-- leasing. Service-role SELECT remains available to the read contract.
revoke insert, update, delete on public.ops_projection_outbox from service_role;
grant select on public.ops_projection_outbox to service_role;

comment on constraint ops_projection_provider_aggregate_check on public.ops_projection_outbox is
  'Mautic accepts contact/lifecycle only; Chatwoot accepts enquiry/support only.';

commit;
