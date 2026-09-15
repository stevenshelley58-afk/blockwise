-- One budget alert per Meta campaign and reporting period. The Mautic event is
-- queued before these markers advance, so a failed enqueue remains retryable.
alter table public.meta_publish_plans
  add column if not exists budget_alert_period_key text,
  add column if not exists budget_alerted_at timestamptz;

comment on column public.meta_publish_plans.budget_alert_period_key is
  'Last reporting range (since:until) for which the 80 percent Mautic budget event was queued.';

comment on column public.meta_publish_plans.budget_alerted_at is
  'Time the latest budget-alert Mautic job was durably queued.';
