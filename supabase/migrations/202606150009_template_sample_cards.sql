-- Template sample cards: original Meta-style preview assets for the template
-- picker. These paths point to generated Blockwise-owned samples in the
-- public template-cards bucket, never observed competitor media.

begin;

alter table if exists research.ad_template_candidates
  add column if not exists sample_card_image_path text,
  add column if not exists sample_style jsonb not null default '{}'::jsonb;

alter table if exists research.ad_template_candidates
  drop constraint if exists ad_template_candidates_sample_style_json_check,
  add constraint ad_template_candidates_sample_style_json_check
    check (jsonb_typeof(sample_style) = 'object'),
  drop constraint if exists ad_template_candidates_sample_card_path_check,
  add constraint ad_template_candidates_sample_card_path_check
    check (
      sample_card_image_path is null
      or (
        sample_card_image_path !~ '(^/|\\.\\.|^[a-z][a-z0-9+.-]*:)'
        and sample_card_image_path ~ '^[a-zA-Z0-9_/-]+\\.png$'
      )
    );

comment on column research.ad_template_candidates.sample_card_image_path is
  'Object path in the public template-cards bucket for the original sample Meta-style template card.';
comment on column research.ad_template_candidates.sample_style is
  'Template-samples-v1 style facets used to ensure varied generated sample ads.';

insert into storage.buckets (id, name, public)
values ('template-cards', 'template-cards', true)
on conflict (id) do update
set public = true;

drop view if exists research.v_ad_template_library;

create view research.v_ad_template_library as
select
  c.template_key,
  c.status,
  c.category,
  c.audience,
  c.format,
  c.hook_style,
  c.funnel_stage,
  c.adstudio_template_id,
  c.offer_id,
  c.goal,
  c.headline,
  c.primary_text,
  c.description,
  c.cta,
  c.variables,
  c.image_brief_id,
  b.name as image_brief_name,
  c.sample_card_image_path,
  c.sample_style,
  b.ai_prompt_seed,
  coalesce(c.creative_skeleton, b.creative_skeleton) as creative_skeleton,
  c.exemplar_observed_ad_ids,
  c.evidence_score,
  c.winner_rationale,
  c.compliance_note,
  c.updated_at
from research.ad_template_candidates c
left join research.ad_template_image_briefs b on b.brief_id = c.image_brief_id
where c.status = 'approved';

revoke all on research.v_ad_template_library from public, anon, authenticated;
grant select on research.v_ad_template_library to service_role;

commit;
