-- Service-only staging for Frank-generated, source-free AdStudio release artifacts.
-- Customer runtime never resolves templates from these tables.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adstudio-template-factory',
  'adstudio-template-factory',
  false,
  15728640,
  array['image/png', 'application/json']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.adstudio_template_factory_pull_claims (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  factory_cell_id text not null,
  factory_job_id text not null,
  request_id text not null,
  claimed_at timestamptz not null default now()
);

create table if not exists public.adstudio_template_factory_clone_requests (
  factory_cell_id text not null,
  factory_job_id text not null,
  request_id text not null,
  intent_hash text not null check (intent_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('running', 'retryable', 'succeeded', 'terminal', 'ambiguous')),
  response_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (factory_cell_id, factory_job_id, request_id)
);

create table if not exists public.adstudio_template_factory_candidates (
  id uuid primary key,
  factory_cell_id text not null,
  factory_job_id text not null,
  request_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  template_id text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  sample_hash text not null check (sample_hash ~ '^[a-f0-9]{64}$'),
  safe_text_hash text not null check (safe_text_hash ~ '^[a-f0-9]{64}$'),
  clone_request_hash text not null check (clone_request_hash ~ '^[a-f0-9]{64}$'),
  qa_hash text not null check (qa_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  storage_path text not null check (storage_path ~ '^template-factory/[a-f0-9]{24}/candidates/[a-f0-9-]+\.png$'),
  evidence_json jsonb not null,
  qa_json jsonb not null,
  attempts_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (factory_cell_id, factory_job_id, request_id),
  unique (factory_cell_id, id)
);

create table if not exists public.adstudio_template_factory_releases (
  id uuid primary key,
  candidate_id uuid not null,
  factory_cell_id text not null,
  factory_job_id text not null,
  request_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  attestation_hash text not null check (attestation_hash ~ '^[a-f0-9]{64}$'),
  sample_hash text not null check (sample_hash ~ '^[a-f0-9]{64}$'),
  bundle_hash text not null check (bundle_hash ~ '^[a-f0-9]{64}$'),
  storage_path text not null check (storage_path ~ '^template-factory/[a-f0-9]{24}/releases/[a-f0-9-]+\.json$'),
  created_at timestamptz not null default now(),
  unique (factory_cell_id, factory_job_id, request_id),
  unique (factory_cell_id, candidate_id),
  unique (factory_cell_id, id),
  foreign key (factory_cell_id, candidate_id)
    references public.adstudio_template_factory_candidates(factory_cell_id, id) on delete restrict
);

create table if not exists public.adstudio_template_factory_receipts (
  id uuid primary key,
  factory_cell_id text not null,
  factory_job_id text not null,
  request_id text not null,
  kind text not null check (kind = 'candidate_png'),
  candidate_id uuid not null,
  storage_path text not null check (storage_path ~ '^template-factory/[a-f0-9]{24}/candidates/[a-f0-9-]+\.png$'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (factory_cell_id, factory_job_id, request_id, kind),
  foreign key (factory_cell_id, candidate_id)
    references public.adstudio_template_factory_candidates(factory_cell_id, id) on delete restrict,
  check (storage_path like '%/candidates/%.png')
);

alter table public.adstudio_template_factory_pull_claims enable row level security;
alter table public.adstudio_template_factory_clone_requests enable row level security;
alter table public.adstudio_template_factory_candidates enable row level security;
alter table public.adstudio_template_factory_releases enable row level security;
alter table public.adstudio_template_factory_receipts enable row level security;

revoke all on public.adstudio_template_factory_pull_claims from anon, authenticated, public;
revoke all on public.adstudio_template_factory_clone_requests from anon, authenticated, public;
revoke all on public.adstudio_template_factory_candidates from anon, authenticated, public;
revoke all on public.adstudio_template_factory_releases from anon, authenticated, public;
revoke all on public.adstudio_template_factory_receipts from anon, authenticated, public;
grant select, insert, update, delete on public.adstudio_template_factory_pull_claims to service_role;
grant select, insert, update, delete on public.adstudio_template_factory_clone_requests to service_role;
grant select, insert, update, delete on public.adstudio_template_factory_candidates to service_role;
grant select, insert, update, delete on public.adstudio_template_factory_releases to service_role;
grant select, insert, update, delete on public.adstudio_template_factory_receipts to service_role;

create or replace function public.claim_adstudio_template_factory_pulls(
  p_factory_cell_id text,
  p_factory_job_id text,
  p_request_id text,
  p_fingerprints text[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  fingerprint_value text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if coalesce(array_length(p_fingerprints, 1), 0) = 0
     or cardinality(p_fingerprints) <> cardinality(array(select distinct value from unnest(p_fingerprints) value)) then
    return false;
  end if;
  foreach fingerprint_value in array p_fingerprints loop
    insert into public.adstudio_template_factory_pull_claims
      (fingerprint, factory_cell_id, factory_job_id, request_id)
    values (fingerprint_value, p_factory_cell_id, p_factory_job_id, p_request_id);
  end loop;
  return true;
exception when unique_violation then
  return false;
end
$$;

create or replace function public.begin_adstudio_template_factory_clone(
  p_factory_cell_id text,
  p_factory_job_id text,
  p_request_id text,
  p_intent_hash text
) returns table (
  disposition text,
  clone_status text,
  response_json jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_rows integer;
  current_request public.adstudio_template_factory_clone_requests%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  insert into public.adstudio_template_factory_clone_requests
    (factory_cell_id, factory_job_id, request_id, intent_hash, status)
  values (p_factory_cell_id, p_factory_job_id, p_request_id, p_intent_hash, 'running')
  on conflict do nothing;
  get diagnostics inserted_rows = row_count;

  select * into current_request
  from public.adstudio_template_factory_clone_requests
  where factory_cell_id = p_factory_cell_id
    and factory_job_id = p_factory_job_id
    and request_id = p_request_id
  for update;

  if current_request.intent_hash <> p_intent_hash then
    return query select 'intent_conflict'::text, current_request.status, current_request.response_json;
  elsif inserted_rows = 1 then
    return query select 'start'::text, current_request.status, current_request.response_json;
  elsif current_request.status = 'retryable' then
    update public.adstudio_template_factory_clone_requests
    set status = 'running', response_json = null, updated_at = now()
    where factory_cell_id = p_factory_cell_id and factory_job_id = p_factory_job_id and request_id = p_request_id;
    return query select 'start'::text, 'running'::text, null::jsonb;
  else
    return query select 'replay'::text, current_request.status, current_request.response_json;
  end if;
end
$$;

create or replace function public.consume_adstudio_template_factory_receipt(
  p_factory_cell_id text,
  p_receipt_id uuid
) returns table (
  kind text,
  storage_path text,
  content_hash text,
  candidate_id uuid
)
language sql
security definer
set search_path = ''
as $$
  update public.adstudio_template_factory_receipts
  set consumed_at = now()
  where factory_cell_id = p_factory_cell_id
    and id = p_receipt_id
    and consumed_at is null
    and expires_at > now()
    and auth.role() = 'service_role'
  returning kind, storage_path, content_hash, candidate_id;
$$;

revoke all on function public.claim_adstudio_template_factory_pulls(text,text,text,text[]) from public, anon, authenticated;
revoke all on function public.begin_adstudio_template_factory_clone(text,text,text,text) from public, anon, authenticated;
revoke all on function public.consume_adstudio_template_factory_receipt(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_adstudio_template_factory_pulls(text,text,text,text[]) to service_role;
grant execute on function public.begin_adstudio_template_factory_clone(text,text,text,text) to service_role;
grant execute on function public.consume_adstudio_template_factory_receipt(text,uuid) to service_role;

do $$
declare
  candidate_rows bigint;
  release_rows bigint;
begin
  select count(*) into candidate_rows from public.adstudio_template_factory_candidates;
  select count(*) into release_rows from public.adstudio_template_factory_releases;
  raise notice 'AdStudio factory staging contains % candidate row(s) and % approved release row(s)', candidate_rows, release_rows;
end
$$;
