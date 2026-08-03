alter table public.demo_requests
  add column if not exists operator_notification_status text not null default 'pending',
  add column if not exists operator_notified_at timestamptz,
  add column if not exists operator_notification_error text,
  add column if not exists operator_notification_message_id text,
  add column if not exists customer_email_status text not null default 'not_required',
  add column if not exists customer_emailed_at timestamptz,
  add column if not exists customer_email_error text,
  add column if not exists customer_email_message_id text;

alter table public.demo_requests
  drop constraint if exists demo_requests_operator_notification_status_check,
  add constraint demo_requests_operator_notification_status_check
    check (operator_notification_status in ('pending', 'sent', 'failed')),
  drop constraint if exists demo_requests_customer_email_status_check,
  add constraint demo_requests_customer_email_status_check
    check (customer_email_status in ('not_required', 'pending', 'sent', 'failed'));

alter table public.report_email_leads
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text,
  add column if not exists delivery_message_id text;

alter table public.report_email_leads
  drop constraint if exists report_email_leads_delivery_status_check,
  add constraint report_email_leads_delivery_status_check
    check (delivery_status in ('pending', 'sent', 'failed'));

create index if not exists demo_requests_delivery_attention_idx
  on public.demo_requests (created_at desc)
  where operator_notification_status <> 'sent' or customer_email_status = 'failed';

create index if not exists report_email_leads_delivery_attention_idx
  on public.report_email_leads (created_at desc)
  where delivery_status <> 'sent';

drop policy if exists demo_requests_operator_select on public.demo_requests;
create policy demo_requests_operator_select
  on public.demo_requests
  for select
  to authenticated
  using ((select private.is_operator()));
