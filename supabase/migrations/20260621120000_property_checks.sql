create table if not exists public.property_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  address text not null check (char_length(btrim(address)) between 3 and 500),
  client_situation text not null check (
    client_situation in (
      'seller_appraisal',
      'buyer_question',
      'investor_subdivision',
      'renovation_extension',
      'general'
    )
  ),
  status text not null check (status in ('success', 'no_source', 'unsupported', 'engine_unavailable')),
  normalized_facts jsonb not null default '{}'::jsonb,
  signals jsonb not null default '[]'::jsonb,
  likely_constraints jsonb not null default '[]'::jsonb,
  talking_points jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  disclaimer text not null,
  engine_request_id text,
  engine_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_checks_normalized_facts_object check (jsonb_typeof(normalized_facts) = 'object'),
  constraint property_checks_signals_array check (jsonb_typeof(signals) = 'array'),
  constraint property_checks_constraints_array check (jsonb_typeof(likely_constraints) = 'array'),
  constraint property_checks_talking_points_array check (jsonb_typeof(talking_points) = 'array'),
  constraint property_checks_citations_array check (jsonb_typeof(citations) = 'array')
);

create or replace function public.set_property_checks_updated_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_property_checks_updated_at on public.property_checks;
create trigger trg_property_checks_updated_at
  before update on public.property_checks
  for each row execute function public.set_property_checks_updated_at();

alter table public.property_checks enable row level security;

drop policy if exists property_checks_select on public.property_checks;
drop policy if exists property_checks_insert on public.property_checks;
drop policy if exists property_checks_update on public.property_checks;
drop policy if exists property_checks_delete on public.property_checks;

create policy property_checks_select on public.property_checks
  for select
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']));

create policy property_checks_insert on public.property_checks
  for insert
  with check (
    private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator'])
    and created_by = (select auth.uid())
  );

create policy property_checks_update on public.property_checks
  for update
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']))
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'member', 'operator']));

create policy property_checks_delete on public.property_checks
  for delete
  using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

create index if not exists property_checks_workspace_created_idx
  on public.property_checks (workspace_id, created_at desc);

create index if not exists property_checks_workspace_status_idx
  on public.property_checks (workspace_id, status, created_at desc);
