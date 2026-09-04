-- Reversible customer-library quarantine for direct Ad Studio templates.
-- Template JSON and asset rows remain unchanged and service-role visible;
-- authenticated customers can read only explicitly active library entries.

alter table public.ad_templates
  add column if not exists library_status text not null default 'active';

alter table public.ad_templates
  drop constraint if exists ad_templates_library_status_check;

alter table public.ad_templates
  add constraint ad_templates_library_status_check
  check (library_status in ('active', 'quarantined'));

comment on column public.ad_templates.library_status is
  'Customer library visibility. Quarantine preserves the template row and assets for inspection and recovery.';

drop policy if exists ad_templates_authenticated_select on public.ad_templates;
create policy ad_templates_authenticated_select on public.ad_templates
  for select to authenticated
  using (library_status = 'active');

drop policy if exists ad_template_assets_direct_authenticated_select on public.ad_template_assets_direct;
create policy ad_template_assets_direct_authenticated_select on public.ad_template_assets_direct
  for select to authenticated
  using (
    exists (
      select 1
      from public.ad_templates as visible_template
      where visible_template.template_id = ad_template_assets_direct.template_id
        and visible_template.library_status = 'active'
    )
  );
