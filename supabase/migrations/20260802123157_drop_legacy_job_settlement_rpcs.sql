-- Apply only after the exact merged web deployment and v2 VPS worker are live;
-- this also removes the legacy producer RPC used by old Vercel deployments.

begin;

revoke execute on function public.claim_job(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.complete_job(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.fail_job(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_job(
  text, jsonb, int, timestamptz, text
) from public, anon, authenticated, service_role;

drop function if exists public.claim_job(text);
drop function if exists public.complete_job(uuid);
drop function if exists public.fail_job(uuid, text);
drop function if exists public.enqueue_job(
  text, jsonb, int, timestamptz, text
);

commit;
