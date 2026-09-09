-- Ad Radar v2 repair, part 2.
--
-- 1. reserve_provider_credits gains an optional p_max_credits ceiling so the
--    supervisor's HERMES_SCRAPINGBEE_MONTHLY_CREDIT_CAP is enforced INSIDE the
--    atomic reservation (the previously declared env cap was never enforced).
--    The 2-argument overload stays for compatibility.
-- 2. Record the checksum-ledger rows for 202609050005 and 202609050006, which
--    were applied to the live research DB directly without a ledger entry.

-- ---------------------------------------------------------------------------
-- 1. Atomic reserve with an optional external ceiling
-- ---------------------------------------------------------------------------
create or replace function research.reserve_provider_credits(
  p_provider text,
  p_credits numeric,
  p_max_credits numeric
)
returns uuid
language plpgsql
security definer
set search_path = research, pg_temp
as $$
declare
  v_budget_id uuid;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'reserve amount must be positive';
  end if;
  if p_max_credits is not null and p_max_credits <= 0 then
    raise exception 'max_credits ceiling must be positive';
  end if;
  -- Single atomic UPDATE: the row lock makes the check-and-reserve
  -- indivisible. The effective ceiling is min(period budget, external cap);
  -- no matching row means the budget is exhausted.
  update research.provider_credit_budgets b
  set reserved_credits = b.reserved_credits + p_credits,
      updated_at = now()
  where b.id = (
    select id from research.provider_credit_budgets
    where provider = p_provider
    order by period_start desc
    limit 1
    for update
  )
    and b.max_credits - b.reserved_credits - b.spent_credits >= p_credits
    and b.spent_credits + b.reserved_credits + p_credits
        <= least(b.max_credits, coalesce(p_max_credits, b.max_credits))
  returning b.id into v_budget_id;

  if v_budget_id is null then
    raise exception 'credit_budget_exhausted: provider % cannot reserve % credits', p_provider, p_credits;
  end if;
  return v_budget_id;
end;
$$;

grant execute on function research.reserve_provider_credits(text, numeric, numeric) to service_role;

comment on function research.reserve_provider_credits(text, numeric, numeric) is
  'Atomic credit reservation. p_max_credits is an optional external monthly '
  'ceiling (e.g. HERMES_SCRAPINGBEE_MONTHLY_CREDIT_CAP) enforced inside the '
  'same row-locked UPDATE as the period budget check.';

-- ---------------------------------------------------------------------------
-- 2. Ledger rows for the migrations applied directly
-- ---------------------------------------------------------------------------
insert into research.schema_migration_ledger (version, name, checksum, applied_by, note) values
  ('202609050005', '202609050005_lifecycle_repair_attempts_credit_budget.sql', '913b2920dc4154beeaae5490225d974b9c35a004a02e3d8f1b7c915f36e4dc58', 'manual', 'lifecycle repair, ad_fetch_attempts, atomic credit budget, schema_migration_ledger; applied directly 2026-09-05'),
  ('202609050006', '202609050006_lifecycle_repeat_call_fix.sql', 'c2e54e4d061ae1eeb8599aa5976a035f870062b8a30c2f2818b52d5544fd24cb', 'manual', 'mark_missing_ads_inactive repeat-call hotfix; applied directly 2026-09-05')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Fresh 1,000-credit allocation as a new budget period
-- ---------------------------------------------------------------------------
-- The ScrapingBee account received a new 1,000-credit allocation (confirmed
-- 2026-09-05, 0 credits spent from it during review). It is modelled as a
-- new budget period; the previous period row is kept as history. Pilot runs
-- additionally cap spending at 800 via their --monthly-cap reservation
-- ceiling.
insert into research.provider_credit_budgets (provider, period_start, max_credits, spent_credits)
values ('scrapingbee', current_date, 1000, 0)
on conflict (provider, period_start) do nothing;

notify pgrst, 'reload schema';
