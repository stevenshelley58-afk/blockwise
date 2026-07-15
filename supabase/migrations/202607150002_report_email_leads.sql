create table if not exists public.report_email_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  postcode text not null check (postcode ~ '^\d{4}$'),
  suburb text not null,
  source text not null default 'suburb-report',
  created_at timestamptz not null default now()
);

alter table public.report_email_leads enable row level security;

revoke all on table public.report_email_leads from anon, authenticated;
grant all on table public.report_email_leads to service_role;

create index if not exists report_email_leads_postcode_created_idx
  on public.report_email_leads (postcode, created_at desc);
