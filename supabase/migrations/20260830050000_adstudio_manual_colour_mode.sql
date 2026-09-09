-- Expand the persisted Ad Studio palette mode to support customer-authored
-- semantic colours. The replacement constraint is validated before the
-- original constraint is removed, so writes remain protected throughout.

do $migration$
declare
  current_definition text;
begin
  if to_regclass('public.ad_customer_ads') is null then
    raise exception 'ad_customer_ads is required before manual colour mode can be enabled';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into current_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.ad_customer_ads'::regclass
    and constraint_row.conname = 'ad_customer_ads_colour_mode_check'
    and constraint_row.contype = 'c';

  if current_definition is null then
    raise exception 'expected constraint ad_customer_ads_colour_mode_check is missing';
  end if;

  -- A replay after the constraint rename is already complete.
  if current_definition like '%manual%' then
    return;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.ad_customer_ads'::regclass
      and constraint_row.conname = 'ad_customer_ads_colour_mode_expanded_check'
  ) then
    raise exception 'temporary manual colour constraint already exists; inspect the interrupted migration';
  end if;

  alter table public.ad_customer_ads
    add constraint ad_customer_ads_colour_mode_expanded_check
    check (colour_mode in ('template', 'brand_pack', 'manual'))
    not valid;

  alter table public.ad_customer_ads
    validate constraint ad_customer_ads_colour_mode_expanded_check;

  alter table public.ad_customer_ads
    drop constraint ad_customer_ads_colour_mode_check;

  alter table public.ad_customer_ads
    rename constraint ad_customer_ads_colour_mode_expanded_check
    to ad_customer_ads_colour_mode_check;
end
$migration$;
