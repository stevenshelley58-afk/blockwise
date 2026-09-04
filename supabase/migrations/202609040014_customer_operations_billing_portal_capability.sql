-- Billing portal links remain intentionally unavailable until a complete,
-- short-lived provider action executor exists. This forward migration also
-- corrects installations that already applied the initial capability seed.
begin;

update public.ops_action_capabilities
   set capability_state = 'capability_required',
       description = 'operator billing portal-link executor is not registered',
       updated_at = now()
 where action_type = 'billing_portal_link';

commit;
