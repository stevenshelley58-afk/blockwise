-- Postcode outreach evidence and review drafts.
-- This schema is deliberately separate from email_outbox: importing a
-- prospect cannot enqueue or deliver a message. The public report is looked
-- up by a SHA-256 hash of a random opaque token; the token is present only in the protected email artifact/report URL.

create table if not exists public.outreach_area_snapshots (
  id uuid primary key default gen_random_uuid(),
  postcode text not null check (postcode ~ '^[0-9]{4}$'),
  coverage_label text not null,
  snapshot_fingerprint text not null check (snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  suburbs jsonb not null default '[]'::jsonb,
  scan_status text not null check (scan_status in ('recent_ads_observed', 'no_ads_found_after_successful_recent_scan', 'unknown')),
  scan_id text not null,
  scanned_at timestamptz not null,
  scan_completed boolean not null default false,
  scope_verified boolean not null default false,
  scan_source text not null,
  observed_ad_count integer not null check (observed_ad_count >= 0),
  ad_examples jsonb not null default '[]'::jsonb,
  source_rights_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (postcode, scan_id)
);

create table if not exists public.outreach_prospects (
  id uuid primary key default gen_random_uuid(),
  area_snapshot_id uuid not null references public.outreach_area_snapshots(id),
  external_ref text,
  agent_name text not null,
  agency_name text,
  recorded_agent_location text,
  postcode text not null check (postcode ~ '^[0-9]{4}$'),
  agent_page_url text,
  agency_page_url text,
  contact_email text not null,
  contact_provenance jsonb not null,
  advertising_evidence jsonb not null,
  prospect_ad_examples jsonb not null default '[]'::jsonb,
  consent_basis text not null,
  consent_recorded_at timestamptz,
  suppression_clear boolean not null default false,
  source_rights_confirmed boolean not null default false,
  scope_verified boolean not null default false,
  data_fresh_at timestamptz not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  area_snapshot_id uuid not null references public.outreach_area_snapshots(id),
  prospect_id uuid not null references public.outreach_prospects(id),
  idempotency_key text not null unique,
  import_fingerprint text not null check (import_fingerprint ~ '^[a-f0-9]{64}$'),
  report_url text not null,
  report_token_hash text not null unique check (report_token_hash ~ '^[a-f0-9]{64}$'),
  email_subject text not null,
  email_html text not null,
  email_text text not null,
  email_template_id text not null,
  email_template_version integer not null,
  evidence_segment text not null check (evidence_segment in ('recent_ads_observed', 'no_ads_found_after_successful_recent_scan', 'unknown')),
  public_report jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'blocked')),
  follow_up_count integer not null default 0 check (follow_up_count between 0 and 1),
  created_at timestamptz not null default now()
);

create index if not exists outreach_area_snapshots_postcode_idx on public.outreach_area_snapshots (postcode, scanned_at desc);
create index if not exists outreach_prospects_snapshot_idx on public.outreach_prospects (area_snapshot_id, created_at desc);
create index if not exists outreach_drafts_status_idx on public.outreach_campaign_drafts (status, created_at desc);
create unique index if not exists outreach_prospects_snapshot_contact_idx on public.outreach_prospects (area_snapshot_id, contact_email);

create or replace function public.reject_outreach_snapshot_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'outreach_area_snapshots are immutable';
end;
$$;

drop trigger if exists outreach_area_snapshots_immutable on public.outreach_area_snapshots;
create trigger outreach_area_snapshots_immutable
before update or delete on public.outreach_area_snapshots
for each row execute function public.reject_outreach_snapshot_mutation();

alter table public.outreach_area_snapshots enable row level security;
alter table public.outreach_prospects enable row level security;
alter table public.outreach_campaign_drafts enable row level security;

revoke all on table public.outreach_area_snapshots from anon, authenticated;
revoke all on table public.outreach_prospects from anon, authenticated;
revoke all on table public.outreach_campaign_drafts from anon, authenticated;

comment on table public.outreach_area_snapshots is 'Immutable, dated evidence shared by postcode outreach drafts and public reports; imported by service role only.';
comment on table public.outreach_prospects is 'Private provenance, consent, suppression, and recorded agent location for outreach review; never exposed through public reports.';
comment on table public.outreach_campaign_drafts is 'Non-sending campaign review artifact. No row is copied to email_outbox automatically.';

-- One transaction makes retries and concurrent importer calls safe. Research stays upstream.
create or replace function public.outreach_import_draft(p_snapshot jsonb, p_prospect jsonb, p_draft jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  area public.outreach_area_snapshots;
  person public.outreach_prospects;
  artifact public.outreach_campaign_drafts;
  existing public.outreach_campaign_drafts;
begin
  perform pg_advisory_xact_lock(hashtextextended('outreach:key:' || (p_draft->>'idempotency_key'), 0));
  perform pg_advisory_xact_lock(hashtextextended('outreach:area:' || (p_snapshot->>'postcode') || ':' || (p_snapshot->>'scan_id'), 0));
  select * into existing from public.outreach_campaign_drafts where idempotency_key = p_draft->>'idempotency_key';
  if found then
    if existing.import_fingerprint <> p_draft->>'import_fingerprint' then raise exception 'import_conflict'; end if;
    if existing.status <> 'draft' then raise exception 'draft_blocked'; end if;
    return jsonb_build_object('draft', to_jsonb(existing), 'replayed', true);
  end if;
  select * into area from public.outreach_area_snapshots where postcode = p_snapshot->>'postcode' and scan_id = p_snapshot->>'scan_id';
  if found then
    if area.snapshot_fingerprint <> p_snapshot->>'snapshot_fingerprint' then raise exception 'snapshot_conflict'; end if;
  else
    area := jsonb_populate_record(null::public.outreach_area_snapshots, p_snapshot);
    area.id := gen_random_uuid(); area.created_at := now();
    insert into public.outreach_area_snapshots select area.*;
  end if;
  select * into person from public.outreach_prospects where area_snapshot_id = area.id and contact_email = lower(p_prospect->>'contact_email');
  if found then
    select * into existing from public.outreach_campaign_drafts where prospect_id = person.id;
    if not found or existing.import_fingerprint <> p_draft->>'import_fingerprint' then raise exception 'import_conflict'; end if;
    if existing.status <> 'draft' then raise exception 'draft_blocked'; end if;
    return jsonb_build_object('draft', to_jsonb(existing), 'replayed', true);
  end if;
  person := jsonb_populate_record(null::public.outreach_prospects, p_prospect);
  person.id := gen_random_uuid(); person.area_snapshot_id := area.id; person.created_at := now();
  if person.is_demo is distinct from false or person.suppression_clear is distinct from true then raise exception 'draft_blocked'; end if;
  insert into public.outreach_prospects select person.*;
  artifact := jsonb_populate_record(null::public.outreach_campaign_drafts, p_draft);
  artifact.id := gen_random_uuid(); artifact.area_snapshot_id := area.id; artifact.prospect_id := person.id;
  artifact.created_at := now(); artifact.status := 'draft'; artifact.follow_up_count := 0;
  insert into public.outreach_campaign_drafts select artifact.*;
  return jsonb_build_object('draft', to_jsonb(artifact), 'replayed', false);
end;
$$;
revoke all on function public.outreach_import_draft(jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.outreach_import_draft(jsonb,jsonb,jsonb) to service_role;
grant select, insert, update, delete on public.outreach_area_snapshots, public.outreach_prospects, public.outreach_campaign_drafts to service_role;

create or replace function public.reject_outreach_artifact_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if (to_jsonb(new) - array['status','follow_up_count']) is distinct from (to_jsonb(old) - array['status','follow_up_count']) then
    raise exception 'outreach draft content is immutable';
  end if;
  return new;
end;
$$;
create trigger outreach_campaign_drafts_immutable before update on public.outreach_campaign_drafts
for each row execute function public.reject_outreach_artifact_mutation();
