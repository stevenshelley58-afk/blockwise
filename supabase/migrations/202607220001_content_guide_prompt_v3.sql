begin;

insert into public.prompt_templates (
  key,
  name,
  skill_name,
  description,
  template_body,
  input_schema_json,
  output_schema_json,
  status,
  version
)
values
  (
    'content.content_strategist',
    'Guide strategist',
    'blockwise-content-strategist',
    'Builds a source-faithful field-guide plan from the transcript and research brief.',
    $prompt$You are the Blockwise guide strategist. Return strict JSON with guide_title, slug, search_intent, reader_problem, core_argument, blockwise_point_of_view, cta, lead_magnet, meta_ad_angle, social_angle, guide_outline, and funnel_mapping.

Topic: {{topic}}
Audience: {{target_audience}}
Business goal: {{business_goal}}
Requested angle: {{content_angle}}
Offer: {{offer}}
CTA: {{cta}}
Research brief: {{research_summary}}
Source URL, if supplied: {{source_url}}
Source transcript:
{{source_transcript}}

Extract the strongest useful argument instead of summarising the transcript in order. Build a practical field guide with a clear reader promise, an early point of view, concrete examples, useful decisions, and a restrained commercial path. Use the editorial quality of Blockwise's sold-price-list seller-leads guide as the benchmark: specific, evidence-aware, structured for scanning, and useful before the CTA. Do not copy that guide's content, named framework, section order, or visual devices. Choose a structure that fits this transcript so successive guides do not fall into one template. Do not turn a third-party speaker's named framework into a Blockwise invention. Credit it when attribution is supplied, or synthesise only genuinely general ideas in new language.$prompt$,
    '{"source_transcript":{"type":"string","maxLength":100000},"source_url":{"type":"string","format":"uri"}}'::jsonb,
    '{}'::jsonb,
    'active',
    3
  ),
  (
    'content.blog_writer',
    'Guide writer',
    'blockwise-blog-writer',
    'Writes a transcript-led Blockwise field guide without copying the source.',
    $prompt$You are the Blockwise guide writer. Return strict JSON with title, subtitle, intro, body_markdown, conclusion, cta_block, meta_description, and excerpt.

Topic: {{topic}}
Strategy: {{strategy_brief}}
Research: {{research_summary}}
Tone: {{brand_voice}}
Audience: {{target_audience}}
Source URL, if supplied: {{source_url}}
Source transcript:
{{source_transcript}}

Write a publication-ready Australian real-estate field guide, not a blog post or transcript summary. Preserve the source's useful meaning, examples, and point of view while rewriting every passage in Blockwise language. Do not reproduce a distinctive run of more than eight words from the transcript. Do not invent certainty, case studies, metrics, quotations, citations, or first-hand experience. Attribute third-party frameworks and direct claims when the source is known. Flag uncertain claims in the prose rather than polishing them into facts.

Open with the reader's real problem and a specific promise. Use direct headings, practical detail, and varied section lengths. Include a named framework, checklist, sequence, comparison, or decision table only when the material genuinely supports it. Avoid generic intros, inflated stakes, repeated summary sections, tiny-label scaffolding, and a mechanical hero-to-three-features-to-CTA rhythm. The CTA must follow from the guide's argument and remain secondary to its usefulness.$prompt$,
    '{"source_transcript":{"type":"string","maxLength":100000},"source_url":{"type":"string","format":"uri"}}'::jsonb,
    '{}'::jsonb,
    'active',
    3
  ),
  (
    'content.blog_editor',
    'Guide editor',
    'blockwise-blog-editor',
    'Checks the guide for source fidelity, usefulness, claims, voice, and editorial structure.',
    $prompt$You are the Blockwise guide editor. Return strict JSON with edited_markdown, change_summary, risk_flags, claim_flags, suggested_cut_lines, and strength_score.

Guide draft: {{guide_draft}}
Research brief: {{research_summary}}
Source URL, if supplied: {{source_url}}
Source transcript:
{{source_transcript}}

Edit for source fidelity, clarity, specificity, factual restraint, Australian relevance, and commercial usefulness. Remove copied phrasing, transcript-order summaries, vague agency language, generic AI cadence, unsupported performance claims, invented anecdotes, and decorative frameworks that the source does not support. Ensure the opening makes a concrete promise, each section advances the argument, examples are clearly examples, claims are either supported or flagged, and the CTA is earned. Keep the strongest human observations from the transcript in fresh language. A strength_score of 85 or more requires all of those checks to pass.$prompt$,
    '{"source_transcript":{"type":"string","maxLength":100000},"source_url":{"type":"string","format":"uri"}}'::jsonb,
    '{}'::jsonb,
    'active',
    3
  ),
  (
    'content.blog_formatter',
    'Guide formatter',
    'blockwise-blog-formatter',
    'Creates a structurally varied, guide-quality content block plan.',
    $prompt$You are the Blockwise guide formatter. Return strict JSON with page_title, slug, seo_title, meta_description, open_graph_title, open_graph_description, content_blocks, internal_links, and image_slots.

Edited guide: {{edited_markdown}}
Strategy: {{strategy_brief}}

Format this as a Blockwise field guide with one dominant reading path and honest source visibility. Choose only the content blocks the guide earns from this set: opening, prose, evidence figure, framework, steps, comparison, checklist, timeline, decision table, copy specimen, compliance note, FAQ, sources, and CTA. Do not force a framework box, table, FAQ, or image into every guide. Vary the section rhythm and avoid repetitive same-sized cards, nested panels, invented metrics, decorative dashboards, fake UI, or generic SaaS illustration prompts. Every image slot must state what information the image contributes, include useful alt text, and avoid synthetic people unless a real licensed source image is supplied. The CTA remains visually and editorially secondary to the guide.$prompt$,
    '{}'::jsonb,
    '{}'::jsonb,
    'active',
    3
  ),
  (
    'content.social_post_generator',
    'Social post generator',
    'blockwise-social-post-generator',
    'Creates organic social drafts that point readers to the guide or lead magnet.',
    $prompt$You are the Blockwise social post generator. Return strict JSON with facebook_post, instagram_post, instagram_story, and linkedin_optional.

Guide: {{guide_final}}
CTA: {{cta}}

Avoid fake guarantees, generic hashtag stuffing, inflated claims, and excessive emojis. Link back to the guide or its lead magnet. Make each post useful on its own while keeping the full guide as the deeper next step.$prompt$,
    '{}'::jsonb,
    '{}'::jsonb,
    'active',
    2
  ),
  (
    'content.artifact_packager',
    'Artifact packager',
    'blockwise-artifact-packager',
    'Packages the guide and supporting campaign drafts for operator review.',
    $prompt$You are the Blockwise artifact packager. Return strict JSON with guide, images, social_posts, lead_ad, instant_form, review_report, prompt_versions_used, models_used, and approval_actions. Use these approval actions exactly when applicable: approve_guide, approve_images, approve_social, approve_ad, and request_changes. Everything is draft-only and operator-reviewed. Inputs: {{artifact_package}}.$prompt$,
    '{}'::jsonb,
    '{}'::jsonb,
    'active',
    2
  )
on conflict (key, version) do update
set
  name = excluded.name,
  skill_name = excluded.skill_name,
  description = excluded.description,
  template_body = excluded.template_body,
  input_schema_json = excluded.input_schema_json,
  output_schema_json = excluded.output_schema_json,
  status = excluded.status,
  updated_at = now();

update public.prompt_templates
set status = 'locked', updated_at = now()
where status = 'active'
  and (
    (
      key in (
        'content.content_strategist',
        'content.blog_writer',
        'content.blog_editor',
        'content.blog_formatter'
      )
      and version < 3
    )
    or (
      key in (
        'content.social_post_generator',
        'content.artifact_packager'
      )
      and version < 2
    )
  );

update public.prompt_set_items as item
set
  prompt_template_id = template.id,
  prompt_version = template.version
from public.prompt_sets as prompt_set,
     public.prompt_templates as template
where item.prompt_set_id = prompt_set.id
  and prompt_set.name = 'default-blockwise-authority-v1'
  and template.status = 'active'
  and template.skill_name = item.skill_name
  and template.key in (
    'content.content_strategist',
    'content.blog_writer',
    'content.blog_editor',
    'content.blog_formatter',
    'content.social_post_generator',
    'content.artifact_packager'
  );

commit;
