-- Account settings: per-user notification preferences + Stripe billing scaffold.
-- Additive and idempotent. Safe to run on an existing production database:
-- it only ADDs nullable/defaulted columns and changes no existing data or RLS.
-- Existing row-level update policies on profiles (self-or-operator) and
-- workspaces (owner/admin/operator) already cover these new columns.

alter table public.profiles
  add column if not exists notification_preferences jsonb not null default '{}'::jsonb;

alter table public.workspaces
  add column if not exists billing_email text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text;

comment on column public.profiles.notification_preferences is
  'Per-user email notification toggles, e.g. {"approvalRequests":true,"leadAlerts":true,"weeklyDigest":false,"productUpdates":false}.';
comment on column public.workspaces.stripe_customer_id is
  'Stripe customer id; null until billing is connected. Scaffold for future Stripe integration.';
comment on column public.workspaces.stripe_subscription_status is
  'Mirror of the Stripe subscription status (active, past_due, canceled, ...). Null until billing is connected.';
