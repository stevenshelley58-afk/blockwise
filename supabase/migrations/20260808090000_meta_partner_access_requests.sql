-- Meta partner-access requests: the customer self-reports which ad account and
-- Facebook Page they shared with Blockwise's Business Manager. An operator
-- verifies the pair and promotes it into meta_partner_account_assignments —
-- customers never wait on an invisible manual step with no signal anymore.

create table if not exists public.meta_partner_access_requests (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]+$'),
  page_id text not null check (page_id ~ '^[0-9]+$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  ad_account_visible boolean not null default false,
  page_visible boolean not null default false,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_partner_access_requests enable row level security;
revoke all on table public.meta_partner_access_requests from public, anon, authenticated;
grant all on table public.meta_partner_access_requests to service_role;

comment on table public.meta_partner_access_requests is
  'Customer-submitted Meta partner-access claims (ad account + Page) awaiting operator verification into meta_partner_account_assignments.';
