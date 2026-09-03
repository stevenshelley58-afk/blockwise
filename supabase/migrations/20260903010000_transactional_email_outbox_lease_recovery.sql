-- Additive hardening for installations that already applied the initial outbox migration.
-- The default keeps historical demo requests from receiving retroactive mail;
-- new submissions explicitly enter the pending recovery state.
alter table public.email_outbox
  add column if not exists lease_token uuid,
  add column if not exists provider_message_id text,
  add column if not exists settlement_projected_at timestamptz,
  add column if not exists settlement_projection_error text;

create or replace function public.claim_email_outbox_batch(p_batch_size integer)
returns setof public.email_outbox
language sql
security definer
set search_path = public
as $$
  update public.email_outbox
  set status = 'sending',
      attempts = attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes'
  where id in (
    select id from public.email_outbox
    where (status in ('pending', 'failed') and next_attempt_at <= now())
       or (status = 'sending' and (lease_expires_at is null or lease_expires_at <= now()))
    order by created_at
    limit greatest(1, least(coalesce(p_batch_size, 10), 100))
    for update skip locked
  )
  returning *;
$$;

alter table public.demo_requests
  add column if not exists lead_welcome_enqueue_status text not null default 'queued',
  add column if not exists lead_welcome_enqueue_error text;

alter table public.demo_requests
  drop constraint if exists demo_requests_lead_welcome_enqueue_status_check;
alter table public.demo_requests
  add constraint demo_requests_lead_welcome_enqueue_status_check
  check (lead_welcome_enqueue_status in ('pending', 'queued', 'failed'));

create index if not exists demo_requests_lead_welcome_recovery_idx
  on public.demo_requests (created_at)
  where lead_welcome_enqueue_status in ('pending', 'failed');

comment on column public.email_outbox.payload is 'Rendered delivery payload (subject, html/text body, sender, reply-to); may contain customer PII and is retained under product policy. Reserved delivery fields are owned by enqueueEmail.';
comment on column public.email_outbox.provider_message_id is 'Provider-assigned delivery identifier; presence confirms provider acceptance, not exactly-once delivery.';


create table if not exists public.email_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('lead.replied', 'lead.converted')),
  lead_id text not null,
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.email_lifecycle_events enable row level security;
revoke all on public.email_lifecycle_events from public, anon, authenticated;
grant all on public.email_lifecycle_events to service_role;


alter table public.demo_requests drop constraint if exists demo_requests_operator_notification_status_check;
alter table public.demo_requests add constraint demo_requests_operator_notification_status_check check (operator_notification_status in ('pending', 'queued', 'sent', 'failed'));
alter table public.demo_requests drop constraint if exists demo_requests_customer_email_status_check;
alter table public.demo_requests add constraint demo_requests_customer_email_status_check check (customer_email_status in ('not_required', 'pending', 'queued', 'sent', 'failed'));
alter table public.report_email_leads drop constraint if exists report_email_leads_delivery_status_check;
alter table public.report_email_leads add constraint report_email_leads_delivery_status_check check (delivery_status in ('pending', 'queued', 'sent', 'failed'));

create index if not exists email_outbox_settlement_recovery_idx
  on public.email_outbox (created_at)
  where status in ('sent', 'failed', 'dead', 'suppressed') and settlement_projected_at is null;
