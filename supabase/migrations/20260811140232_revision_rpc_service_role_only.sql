begin;

-- Revision mutation inputs include the complete next canvas. They must never
-- be callable with a browser session: the authenticated route first verifies
-- workspace membership, then supplies a service-role client only after it has
-- rendered and validated the server-authoritative result.
revoke all on function public.adstudio_claim_creative_revision_mutation(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.adstudio_claim_creative_revision_mutation(uuid, uuid, uuid, uuid, text)
  to service_role;

revoke all on function public.adstudio_release_creative_revision_mutation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.adstudio_release_creative_revision_mutation(uuid, uuid, uuid)
  to service_role;

revoke all on function public.adstudio_append_creative_revision(
  uuid, uuid, uuid, jsonb, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.adstudio_append_creative_revision(
  uuid, uuid, uuid, jsonb, text, text, uuid, text
) to service_role;

comment on function public.adstudio_append_creative_revision(
  uuid, uuid, uuid, jsonb, text, text, uuid, text
) is 'Internal-only revision CAS. Customer requests are authorized and rendered by a server route before service-role execution.';

commit;
