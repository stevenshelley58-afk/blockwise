create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested', 'verified', 'processing', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant all on table public.account_deletion_requests to service_role;

create index if not exists account_deletion_requests_attention_idx
  on public.account_deletion_requests (requested_at)
  where status in ('requested', 'verified', 'processing');
