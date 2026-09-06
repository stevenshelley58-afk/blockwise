-- Direct-template customer ads store their ad id in
-- meta_publish_plans.adstudio_campaign_id (write path: buildPausedPlan in
-- publish-adapter.ts; read paths: loadLatestPublishPlanForAd and the library
-- read model both query it by ad id). The original constraint pointed at
-- adstudio_campaigns(id), which no direct-template ad satisfies, so every
-- customer publish failed the plan insert. Point the constraint at the table
-- the application actually references.
alter table public.meta_publish_plans
  drop constraint if exists meta_publish_plans_adstudio_campaign_id_fkey;

alter table public.meta_publish_plans
  add constraint meta_publish_plans_adstudio_campaign_id_fkey
  foreign key (adstudio_campaign_id) references public.ad_customer_ads (id)
  on delete cascade;
