-- Event-driven AdBuilder completion replaces high-frequency browser polling.
-- Both tables already have workspace-scoped RLS SELECT policies.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adbuilder_creatives'
  ) then
    alter publication supabase_realtime add table public.adbuilder_creatives;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adbuilder_creative_jobs'
  ) then
    alter publication supabase_realtime add table public.adbuilder_creative_jobs;
  end if;
end
$$;

-- Cover the referencing side of both foreign keys before performance history
-- grows. Partial indexes stay small while the links are optional.
create index if not exists owned_ad_performance_adbuilder_campaign_idx
  on public.owned_ad_performance (adbuilder_campaign_id)
  where adbuilder_campaign_id is not null;

create index if not exists owned_ad_performance_adbuilder_creative_idx
  on public.owned_ad_performance (adbuilder_creative_id)
  where adbuilder_creative_id is not null;
