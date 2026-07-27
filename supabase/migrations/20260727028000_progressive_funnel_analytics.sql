begin;

create table if not exists public.progressive_funnel_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'cta_clicked',
    'email_submitted',
    'email_verified',
    'website_submitted',
    'brand_pack_approved',
    'template_selected',
    'first_generation_started',
    'first_generation_completed',
    'third_free_ad_completed',
    'meta_prompt_shown',
    'meta_connected',
    'meta_help_requested',
    'checkout_started',
    'checkout_completed',
    'free_campaign_launched',
    'first_invoice_paid',
    'onboarding_booked',
    'onboarding_completed',
    'first_renewal_paid',
    'managed_inquiry',
    'managed_checkout',
    'cancellation',
    'payment_failed'
  )),
  event_domain text not null check (event_domain in ('marketing', 'activation', 'meta', 'billing', 'booking')),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  country_code text check (country_code is null or country_code in ('US', 'AU')),
  acquisition_source text not null check (
    length(btrim(acquisition_source)) between 1 and 128
  ),
  idempotency_key text not null unique check (
    length(btrim(idempotency_key)) between 1 and 256
    and idempotency_key !~ '[[:space:]@]'
  ),
  occurred_at timestamptz not null,
  properties jsonb not null default '{}'::jsonb check (
    jsonb_typeof(properties) = 'object'
    and jsonb_array_length(jsonb_path_query_array(properties, '$.keyvalue()')) <= 32
  ),
  created_at timestamptz not null default now()
);

create index if not exists progressive_funnel_events_occurred_at_idx
  on public.progressive_funnel_events (occurred_at desc);
create index if not exists progressive_funnel_events_workspace_occurred_idx
  on public.progressive_funnel_events (workspace_id, occurred_at desc)
  where workspace_id is not null;
create index if not exists progressive_funnel_events_country_source_idx
  on public.progressive_funnel_events (country_code, acquisition_source, occurred_at desc);
create index if not exists progressive_funnel_events_name_occurred_idx
  on public.progressive_funnel_events (event_name, occurred_at desc);

alter table public.progressive_funnel_events enable row level security;

revoke all on table public.progressive_funnel_events from public, anon, authenticated;
grant select, insert, update, delete on table public.progressive_funnel_events to service_role;

comment on table public.progressive_funnel_events is
  'Server-confirmed progressive activation, billing, Meta, booking, and managed-service funnel events. Service-role access only.';
comment on column public.progressive_funnel_events.workspace_id is
  'Workspace owning the confirmed event. Null only before a trial workspace exists.';
comment on column public.progressive_funnel_events.acquisition_source is
  'Stable first-touch source captured by the server; never an email address or raw referrer URL.';
comment on column public.progressive_funnel_events.idempotency_key is
  'Opaque server-owned mutation or provider-event key used to deduplicate delivery.';
comment on column public.progressive_funnel_events.properties is
  'Small non-sensitive primitive event facts. Never stores email, provider tokens, card data, or raw request payloads.';

commit;
