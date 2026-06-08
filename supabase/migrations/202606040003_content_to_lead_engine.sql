create table if not exists public.prompt_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  skill_name text not null,
  description text not null default '',
  template_body text not null,
  input_schema_json jsonb not null default '{}',
  output_schema_json jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'active', 'locked', 'archived')),
  version integer not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

create table if not exists public.prompt_set_items (
  id uuid primary key default gen_random_uuid(),
  prompt_set_id uuid not null references public.prompt_sets (id) on delete cascade,
  skill_name text not null,
  prompt_template_id uuid not null references public.prompt_templates (id) on delete restrict,
  prompt_version integer not null,
  model_policy_id text not null,
  created_at timestamptz not null default now(),
  unique (prompt_set_id, skill_name)
);

create table if not exists public.content_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  operator_user_id uuid references public.profiles (id),
  topic text not null,
  target_audience text not null,
  business_goal text not null,
  content_angle text not null,
  offer text not null,
  primary_cta text not null,
  prompt_set_id uuid references public.prompt_sets (id) on delete set null,
  model_policy_id text not null default 'best-available-balanced',
  publish_mode text not null default 'draft_only' check (
    publish_mode in ('draft_only', 'publish_blog_only', 'publish_social_only', 'prepare_ad_only', 'publish_all_after_approval')
  ),
  status text not null default 'queued' check (
    status in (
      'queued',
      'researching',
      'briefing',
      'drafting',
      'editing',
      'formatting',
      'image_prompting',
      'image_generation',
      'image_review',
      'page_building',
      'social_generation',
      'ad_generation',
      'compliance_review',
      'final_review',
      'waiting_operator_approval',
      'approved',
      'publish_ready',
      'published',
      'needs_operator_image_review',
      'failed'
    )
  ),
  current_step text,
  input_json jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.content_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_run_id uuid not null references public.content_runs (id) on delete cascade,
  artifact_type text not null check (
    artifact_type in (
      'research_brief',
      'strategy_brief',
      'blog_draft',
      'blog_final',
      'formatted_page',
      'image_prompt',
      'image_file',
      'seo_schema',
      'social_facebook',
      'social_instagram',
      'lead_ad',
      'instant_form',
      'review_report',
      'compliance_report',
      'artifact_package'
    )
  ),
  title text not null default '',
  status text not null default 'draft' check (status in ('draft', 'generated', 'approved', 'rejected', 'failed')),
  data_json jsonb not null default '{}',
  file_url text,
  preview_url text,
  model_used text,
  prompt_template_id uuid references public.prompt_templates (id) on delete set null,
  prompt_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_run_id uuid not null references public.content_runs (id) on delete cascade,
  prompt_template_id uuid references public.prompt_templates (id) on delete set null,
  prompt_version integer not null,
  skill_name text not null,
  resolved_prompt_hash text not null,
  provider text,
  model_used text,
  model_policy_id text,
  input_json jsonb not null default '{}',
  output_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.content_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_run_id uuid not null references public.content_runs (id) on delete cascade,
  review_type text not null,
  reviewer_type text not null check (reviewer_type in ('ai', 'operator')),
  score numeric(5, 2),
  status text not null check (status in ('pass', 'fail', 'needs_human', 'approve', 'revise', 'reject')),
  issues_json jsonb not null default '[]',
  required_changes_json jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.operator_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_run_id uuid not null references public.content_runs (id) on delete cascade,
  artifact_type text not null,
  approved_by uuid references public.profiles (id),
  approval_status public.approval_status not null default 'requested',
  notes text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (content_run_id, artifact_type)
);

alter table public.prompt_sets enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.prompt_set_items enable row level security;
alter table public.content_runs enable row level security;
alter table public.content_artifacts enable row level security;
alter table public.prompt_runs enable row level security;
alter table public.content_reviews enable row level security;
alter table public.operator_approvals enable row level security;

create policy prompt_sets_read_authenticated on public.prompt_sets for select to authenticated using (true);
create policy prompt_sets_operator_write on public.prompt_sets for all using (public.is_operator()) with check (public.is_operator());
create policy prompt_templates_read_authenticated on public.prompt_templates for select to authenticated using (true);
create policy prompt_templates_operator_write on public.prompt_templates for all using (public.is_operator()) with check (public.is_operator());
create policy prompt_set_items_read_authenticated on public.prompt_set_items for select to authenticated using (true);
create policy prompt_set_items_operator_write on public.prompt_set_items for all using (public.is_operator()) with check (public.is_operator());

create policy content_runs_workspace_select on public.content_runs for select using (public.is_operator() or public.is_workspace_member(workspace_id));
create policy content_runs_operator_insert on public.content_runs for insert with check (public.has_workspace_role(workspace_id, array['operator']));
create policy content_runs_operator_update on public.content_runs for update using (public.has_workspace_role(workspace_id, array['operator'])) with check (public.has_workspace_role(workspace_id, array['operator']));
create policy content_runs_operator_delete on public.content_runs for delete using (public.has_workspace_role(workspace_id, array['operator']));

create policy content_artifacts_workspace_select on public.content_artifacts for select using (public.is_operator() or public.is_workspace_member(workspace_id));
create policy content_artifacts_server_owned_no_client_insert on public.content_artifacts for insert to authenticated with check (false);
create policy content_artifacts_server_owned_no_client_update on public.content_artifacts for update to authenticated using (false) with check (false);
create policy content_artifacts_server_owned_no_client_delete on public.content_artifacts for delete to authenticated using (false);

create policy prompt_runs_workspace_select on public.prompt_runs for select using (public.is_operator() or public.is_workspace_member(workspace_id));
create policy prompt_runs_server_owned_no_client_insert on public.prompt_runs for insert to authenticated with check (false);
create policy prompt_runs_server_owned_no_client_update on public.prompt_runs for update to authenticated using (false) with check (false);
create policy prompt_runs_server_owned_no_client_delete on public.prompt_runs for delete to authenticated using (false);

create policy content_reviews_workspace_select on public.content_reviews for select using (public.is_operator() or public.is_workspace_member(workspace_id));
create policy content_reviews_server_owned_no_client_insert on public.content_reviews for insert to authenticated with check (false);
create policy content_reviews_server_owned_no_client_update on public.content_reviews for update to authenticated using (false) with check (false);
create policy content_reviews_server_owned_no_client_delete on public.content_reviews for delete to authenticated using (false);

create policy operator_approvals_workspace_select on public.operator_approvals for select using (public.is_operator() or public.is_workspace_member(workspace_id));
create policy operator_approvals_operator_insert on public.operator_approvals for insert with check (public.has_workspace_role(workspace_id, array['operator']));
create policy operator_approvals_operator_update on public.operator_approvals for update using (public.has_workspace_role(workspace_id, array['operator'])) with check (public.has_workspace_role(workspace_id, array['operator']));
create policy operator_approvals_operator_delete on public.operator_approvals for delete using (public.has_workspace_role(workspace_id, array['operator']));

create index if not exists content_runs_workspace_status_idx on public.content_runs (workspace_id, status, created_at desc);
create index if not exists content_artifacts_run_type_idx on public.content_artifacts (content_run_id, artifact_type, created_at desc);
create index if not exists prompt_runs_run_skill_idx on public.prompt_runs (content_run_id, skill_name, created_at desc);
create index if not exists content_reviews_run_type_idx on public.content_reviews (content_run_id, review_type, created_at desc);
create index if not exists operator_approvals_run_status_idx on public.operator_approvals (content_run_id, approval_status, created_at desc);

insert into public.prompt_sets (name, description, status)
values ('default-blockwise-authority-v1', 'Default Blockwise authority and lead generation prompt set.', 'active')
on conflict (name) do nothing;

insert into public.prompt_templates (key, name, skill_name, description, template_body, input_schema_json, output_schema_json, status, version)
values
  ('content.topic_researcher', 'Topic researcher', 'blockwise-topic-researcher', 'Creates source-backed article research.', 'You are Blockwise topic researcher. Return strict JSON for {{topic}}. Audience: {{target_audience}}. Goal: {{business_goal}}. Angle: {{content_angle}}. Do not invent stats. Prefer official docs for platform behaviour. Output research_summary, source_claims, must_include_points, do_not_claim, open_questions.', '{}', '{}', 'active', 1),
  ('content.content_strategist', 'Content strategist', 'blockwise-content-strategist', 'Turns research into a commercial content plan.', 'You are Blockwise content strategist. Return strict JSON. Topic: {{topic}}. Research: {{research_summary}}. CTA: {{cta}}. Offer: {{offer}}. Use this frame: Problem, why agents misunderstand it, what causes it, Blockwise framework, practical steps, lead magnet CTA. Output blog_title, slug, search_intent, reader_problem, core_argument, blockwise_point_of_view, cta, lead_magnet, meta_ad_angle, social_angle, article_outline, funnel_mapping.', '{}', '{}', 'active', 1),
  ('content.blog_writer', 'Blog writer', 'blockwise-blog-writer', 'Writes the first expert blog draft.', 'You are Blockwise blog writer. Return strict JSON with title, subtitle, intro, body_markdown, conclusion, cta_block, meta_description, excerpt. Topic: {{topic}}. Strategy: {{strategy_brief}}. Research: {{research_summary}}. Tone: {{brand_voice}}. Use Australian real estate context, no hype, no fake certainty, no invented case studies, and include a practical framework and one table.', '{}', '{}', 'active', 1),
  ('content.blog_editor', 'Blog editor', 'blockwise-blog-editor', 'Edits the blog for clarity, specificity, claims, and commercial strength.', 'You are Blockwise blog editor. Return strict JSON with edited_markdown, change_summary, risk_flags, claim_flags, suggested_cut_lines, strength_score. Remove fluff, unsupported stats, and vague agency language. Strengthen the opening and CTA. Draft: {{blog_draft}}.', '{}', '{}', 'active', 1),
  ('content.blog_formatter', 'Blog formatter', 'blockwise-blog-formatter', 'Creates website-ready content blocks.', 'You are Blockwise blog formatter. Return strict JSON with page_title, slug, seo_title, meta_description, open_graph_title, open_graph_description, content_blocks, internal_links, image_slots. Include hero, markdown sections, at least one comparison table, a Blockwise framework box, and one CTA band. Edited article: {{edited_markdown}}.', '{}', '{}', 'active', 1),
  ('content.seo_schema_builder', 'SEO schema builder', 'blockwise-seo-schema-builder', 'Creates SEO metadata and schema JSON-LD.', 'You are Blockwise SEO schema builder. Return strict JSON with seo_title, meta_description, canonical, og_image, schema_json_ld, faq_schema. Do not keyword stuff. Use Blockwise as publisher. Formatted page: {{formatted_page}}.', '{}', '{}', 'active', 1),
  ('content.image_brief_writer', 'Image brief writer', 'blockwise-image-brief-writer', 'Creates controlled image prompts without generating images.', 'You are Blockwise image brief writer. Return strict JSON with image_briefs. Slots: {{image_slots}}. Image style: {{image_style}}. Use premium SaaS look, no fake real estate agent photos, no ugly AI people, no fake Meta logos, no readable fake UI text, no cluttered dashboards. Include prompt, negative_prompt, style_tokens, must_include, must_avoid, alt_text.', '{}', '{}', 'active', 1),
  ('content.page_builder', 'Page builder', 'blockwise-page-builder', 'Creates a draft page package without publishing.', 'You are Blockwise page builder. Return strict JSON with page_path, page_component_path, preview_url, status, build_notes. This phase is draft-only, so status must be draft and preview_url may be an operator preview route. Formatted page: {{formatted_page}}. SEO: {{seo_schema}}.', '{}', '{}', 'active', 1),
  ('content.social_post_generator', 'Social post generator', 'blockwise-social-post-generator', 'Creates organic social drafts.', 'You are Blockwise social post generator. Return strict JSON with facebook_post, instagram_post, instagram_story, linkedin_optional. Article: {{blog_final}}. CTA: {{cta}}. Avoid fake guarantees, generic hashtags, and overuse of emojis. Always link back to the blog or lead magnet.', '{}', '{}', 'active', 1),
  ('content.lead_ad_generator', 'Lead ad generator', 'blockwise-lead-ad-generator', 'Creates Meta lead ad draft package for Blockwise acquiring agents.', 'You are Blockwise Meta lead ad generator. Return strict JSON with campaign_brief, ad_variants, instant_form, lead_scoring, compliance_notes. Offer: {{offer}}. CTA: {{cta}}. Audience: {{target_audience}}. Create five variants: wrong signal, cheap lead problem, boosted post problem, follow-up leak, attribution ROI. Do not imply guaranteed leads or listings.', '{}', '{}', 'active', 1),
  ('content.instant_form_generator', 'Instant form generator', 'blockwise-instant-form-generator', 'Creates the Blockwise lead form draft and scoring.', 'You are Blockwise instant form generator. Return strict JSON with headline, intro, questions, contact_fields, lead_scoring, completion_paths. Use the Free Blockwise Seller Lead Audit default form unless the operator input conflicts. Offer: {{offer}}.', '{}', '{}', 'active', 1),
  ('content.compliance_reviewer', 'Compliance reviewer', 'blockwise-compliance-reviewer', 'Reviews outputs for policy and claim risk.', 'You are Blockwise compliance reviewer. Return strict JSON with status, risk_level, issues, required_changes, approval_blockers. Check Meta policy risk, real estate claims, unsupported performance claims, privacy policy availability, misleading images, fake results, prompt leakage, and personal data leakage. Outputs: {{artifact_package}}.', '{}', '{}', 'active', 1),
  ('content.agent_reviewer', 'Agent reviewer', 'blockwise-agent-reviewer', 'Senior marketing operator review.', 'You are a senior Blockwise marketing operator. Return strict JSON with overall_score, recommendation, best_assets, weak_assets, required_edits, optional_edits, final_summary_for_operator. Minimum approval score is 85. Review package: {{artifact_package}}.', '{}', '{}', 'active', 1),
  ('content.artifact_packager', 'Artifact packager', 'blockwise-artifact-packager', 'Packages everything for operator review.', 'You are Blockwise artifact packager. Return strict JSON with blog, images, social_posts, lead_ad, instant_form, review_report, prompt_versions_used, models_used, approval_actions. Everything is draft-only and operator-reviewed. Inputs: {{artifact_package}}.', '{}', '{}', 'active', 1)
on conflict (key, version) do nothing;

insert into public.prompt_set_items (prompt_set_id, skill_name, prompt_template_id, prompt_version, model_policy_id)
select
  ps.id,
  pt.skill_name,
  pt.id,
  pt.version,
  case pt.skill_name
    when 'blockwise-topic-researcher' then 'best_reasoning'
    when 'blockwise-content-strategist' then 'best_reasoning'
    when 'blockwise-blog-writer' then 'best_copywriting'
    when 'blockwise-blog-editor' then 'critic_review'
    when 'blockwise-blog-formatter' then 'best_json'
    when 'blockwise-seo-schema-builder' then 'best_json'
    when 'blockwise-image-brief-writer' then 'best_image_prompting'
    when 'blockwise-page-builder' then 'code_generation'
    when 'blockwise-social-post-generator' then 'best_copywriting'
    when 'blockwise-lead-ad-generator' then 'best_copywriting'
    when 'blockwise-instant-form-generator' then 'best_json'
    when 'blockwise-compliance-reviewer' then 'critic_review'
    when 'blockwise-agent-reviewer' then 'best_reasoning'
    else 'best_json'
  end
from public.prompt_sets ps
cross join public.prompt_templates pt
where ps.name = 'default-blockwise-authority-v1'
  and pt.key like 'content.%'
  and pt.status = 'active'
on conflict (prompt_set_id, skill_name) do nothing;
