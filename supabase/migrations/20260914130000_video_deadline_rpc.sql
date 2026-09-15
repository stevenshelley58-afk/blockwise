-- A public, service-role-only wrapper for the working-day deadline.
--
-- The rule itself lives in private.video_working_day_deadline so the database
-- owns it. PostgREST only exposes the public schema, so the order service needs
-- a public entry point. This wrapper adds no logic of its own: it forwards the
-- order's own stored commitment, so the due date is always computed from the
-- terms frozen on that order rather than from whatever the offer config says
-- today.

create or replace function public.video_order_first_draft_due_at(
  p_ready_at timestamptz,
  p_working_days integer,
  p_timezone text,
  p_workday_start integer,
  p_workday_end integer
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $fn$
  select private.video_working_day_deadline(
    p_ready_at,
    p_working_days,
    p_timezone,
    p_workday_start,
    p_workday_end
  );
$fn$;

-- Only the privileged server credential may compute a commitment. A browser
-- role has no business deriving a due date; it reads the stored one.
revoke all on function public.video_order_first_draft_due_at(timestamptz, integer, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.video_order_first_draft_due_at(timestamptz, integer, text, integer, integer)
  to service_role;
