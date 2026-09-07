-- A generated template is quarantined on import. It can enter the customer
-- library only after Blockwise itself has rendered both placements and bound
-- that smoke result to the same Hermes run that requests activation.

alter table public.ad_templates
  add column if not exists library_smoke_test_run_id text,
  add column if not exists library_smoke_tested_at timestamptz,
  add column if not exists library_smoke_test_checks jsonb;

-- Anything that was made visible before Blockwise owned a run-bound smoke
-- result is preserved for inspection but removed from customer discovery.
update public.ad_templates set
  library_status = 'quarantined',
  library_review_run_id = null,
  library_reviewed_at = null
where library_status = 'active'
  and (
    library_smoke_test_run_id is null
    or library_smoke_test_checks ->> 'passed' is distinct from 'true'
  );

alter table public.ad_templates drop constraint if exists ad_templates_library_status_check;
alter table public.ad_templates add constraint ad_templates_library_status_check
  check (library_status in ('active', 'quarantined', 'discarding'));

alter table public.ad_templates drop constraint if exists ad_templates_active_review_check;
alter table public.ad_templates add constraint ad_templates_active_review_check check (
  (library_status = 'quarantined' and library_review_run_id is null and library_reviewed_at is null)
  or library_status = 'discarding'
  or (
    library_status = 'active'
    and library_review_run_id is not null
    and library_review_run_id = library_smoke_test_run_id
    and library_reviewed_at is not null
    and library_smoke_tested_at is not null
    and library_smoke_test_checks is not null
    and jsonb_typeof(library_smoke_test_checks) = 'object'
    and library_smoke_test_checks ->> 'passed' = 'true'
  )
);

create or replace function public.record_ad_template_smoke_test(
  p_template_id text,
  p_review_run_id text,
  p_checks jsonb
)
returns table(template_id text, review_run_id text, smoke_tested_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare tested_at timestamptz := statement_timestamp();
begin
  if p_template_id is null or btrim(p_template_id) = ''
     or p_review_run_id is null or p_review_run_id !~ '^[A-Za-z0-9._:-]{8,200}$'
     or p_checks is null
     or jsonb_typeof(p_checks) is distinct from 'object'
     or p_checks ->> 'passed' is distinct from 'true' then
    raise exception 'template_smoke_test_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 2026090501));
  update public.ad_templates as candidate set
    library_smoke_test_run_id = p_review_run_id,
    library_smoke_tested_at = tested_at,
    library_smoke_test_checks = p_checks
  where candidate.template_id = p_template_id
    and candidate.library_status = 'quarantined';
  if not found then raise exception 'template_smoke_test_not_quarantined' using errcode = 'P0001'; end if;

  template_id := p_template_id; review_run_id := p_review_run_id; smoke_tested_at := tested_at;
  return next;
end $$;

create or replace function public.activate_reviewed_ad_template(
  p_template_id text,
  p_review_run_id text
)
returns table(template_id text, library_status text, review_run_id text, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare candidate public.ad_templates%rowtype;
begin
  if p_template_id is null or btrim(p_template_id) = ''
     or p_review_run_id is null or p_review_run_id !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'reviewed_template_activation_invalid' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 2026090501));
  select direct_template.* into candidate from public.ad_templates as direct_template where direct_template.template_id = p_template_id for update;
  if not found then raise exception 'reviewed_template_not_found' using errcode = 'P0001'; end if;
  if candidate.library_status = 'active' and candidate.library_review_run_id = p_review_run_id then
    template_id := p_template_id; library_status := 'active'; review_run_id := p_review_run_id; reviewed_at := candidate.library_reviewed_at;
    return next; return;
  end if;
  if candidate.library_status <> 'quarantined'
     or candidate.library_smoke_test_run_id is distinct from p_review_run_id
     or candidate.library_smoke_test_checks ->> 'passed' <> 'true' then
    raise exception 'reviewed_template_smoke_test_required' using errcode = 'P0001';
  end if;
  update public.ad_templates set library_status = 'active', library_review_run_id = p_review_run_id, library_reviewed_at = statement_timestamp()
  where ad_templates.template_id = p_template_id
  returning ad_templates.library_reviewed_at into reviewed_at;
  template_id := p_template_id; library_status := 'active'; review_run_id := p_review_run_id;
  return next;
end $$;

revoke all on function public.record_ad_template_smoke_test(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.activate_reviewed_ad_template(text, text) from public, anon, authenticated;
grant execute on function public.record_ad_template_smoke_test(text, text, jsonb) to service_role;
grant execute on function public.activate_reviewed_ad_template(text, text) to service_role;
