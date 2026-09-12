-- Workspace publishing defaults: the values an owner sets once for Meta lead
-- publishing, instead of retyping them inside the Meta asset form.
--
-- `publishing_currency` and `publishing_timezone` mirror the connected Meta ad
-- account, which Meta re-checks live at publish time, so they are read-only in
-- the product. Everything else here is a workspace fact the owner owns.
--
-- Additive and idempotent: nullable columns, no defaults, no data loss. The
-- backfill only fills rows that are still null from an existing Meta
-- connection, so a workspace that already had values keeps them.
alter table public.workspaces
  add column if not exists privacy_policy_url text,
  add column if not exists publishing_currency text,
  add column if not exists publishing_timezone text,
  add column if not exists lead_destination_type text,
  add column if not exists lead_destination_label text,
  add column if not exists lead_destination_endpoint text;

alter table public.workspaces
  drop constraint if exists workspaces_lead_destination_type_check;
alter table public.workspaces
  add constraint workspaces_lead_destination_type_check
  check (lead_destination_type is null or lead_destination_type in ('manual', 'webhook', 'crm'));

comment on column public.workspaces.privacy_policy_url is
  'Privacy policy URL attached to Meta lead forms for this workspace. Null until the owner sets it.';
comment on column public.workspaces.publishing_currency is
  'Currency mirrored from the connected Meta ad account. Read-only in the product; Meta re-checks it at publish time.';
comment on column public.workspaces.publishing_timezone is
  'Timezone mirrored from the connected Meta ad account. Read-only in the product; Meta re-checks it at publish time.';
comment on column public.workspaces.lead_destination_type is
  'Where Meta leads are delivered: manual, webhook or crm. Null until the owner chooses.';
comment on column public.workspaces.lead_destination_label is
  'Customer-facing label for the lead destination. Null until the owner sets it.';
comment on column public.workspaces.lead_destination_endpoint is
  'Endpoint that receives Meta leads for webhook and crm destinations. Null for manual review.';

-- Carry an existing Meta connection's stored setup onto the workspace so the
-- Workspace card shows the same values the publish path already uses.
update public.workspaces w
set
  privacy_policy_url = coalesce(w.privacy_policy_url, nullif(btrim(c.metadata_json -> 'meta' ->> 'privacyPolicyUrl'), '')),
  publishing_currency = coalesce(w.publishing_currency, nullif(btrim(c.metadata_json -> 'meta' ->> 'currency'), '')),
  publishing_timezone = coalesce(w.publishing_timezone, nullif(btrim(c.metadata_json -> 'meta' ->> 'timezone'), '')),
  lead_destination_type = coalesce(
    w.lead_destination_type,
    case
      when c.metadata_json -> 'meta' -> 'leadDestination' ->> 'type' in ('manual', 'webhook', 'crm')
        then c.metadata_json -> 'meta' -> 'leadDestination' ->> 'type'
    end
  ),
  lead_destination_label = coalesce(
    w.lead_destination_label,
    nullif(btrim(c.metadata_json -> 'meta' -> 'leadDestination' ->> 'label'), '')
  ),
  lead_destination_endpoint = coalesce(
    w.lead_destination_endpoint,
    nullif(btrim(c.metadata_json -> 'meta' -> 'leadDestination' -> 'config' ->> 'endpoint'), '')
  )
from public.provider_connections c
where c.workspace_id = w.id
  and c.provider = 'meta'
  and c.status in ('connected', 'needs_attention')
  and (
    w.privacy_policy_url is null
    or w.publishing_currency is null
    or w.publishing_timezone is null
    or w.lead_destination_type is null
    or w.lead_destination_label is null
    or w.lead_destination_endpoint is null
  );
