-- Workspace-owned default area for authenticated local-ad discovery.
-- This is deliberately separate from billing and provider targeting.

alter table public.workspaces
  add column if not exists default_postcode text;

alter table public.workspaces
  drop constraint if exists workspaces_default_postcode_format_check;

alter table public.workspaces
  add constraint workspaces_default_postcode_format_check
  check (default_postcode is null or default_postcode ~ '^[0-9]{4}$');

comment on column public.workspaces.default_postcode is
  'Customer-owned default postcode for local Ad Radar discovery. It is not Meta targeting, billing, or a verified service area.';
