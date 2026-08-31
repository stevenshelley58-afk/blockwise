-- Named operator roles.
--
-- profiles.is_operator stays as the operator flag; operator_role distinguishes
-- what the operator may do: 'owner' (full control incl. session revocation and
-- break-glass) vs 'support' (customer support actions only). NULL = not an
-- operator. hasOperatorAccessFromRows continues to treat is_operator as the
-- base gate; role-specific routes check operator_role.
--
-- Also records consent time for operator access so an audit can answer "who
-- could act as operator, since when".
--
-- Rollback:
--   alter table public.profiles drop column if exists operator_role;
--   alter table public.profiles drop column if exists operator_since;

alter table public.profiles
  add column if not exists operator_role text
  check (operator_role in ('owner', 'support'));

alter table public.profiles
  add column if not exists operator_since timestamptz;

-- Backfill: any existing operator becomes 'owner' until Steven assigns
-- support roles deliberately. operator_since is set from the profile update
-- time as the best available provenance.
update public.profiles
set operator_role = 'owner',
    operator_since = coalesce(updated_at, now())
where is_operator is true
  and operator_role is null;
