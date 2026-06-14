-- Template card images: a generated, on-brand ad creative per mined image brief.
-- Additive only — adds a nullable path column and a public storage bucket. The
-- gallery falls back to static cards when a brief has no generated image yet.

alter table if exists research.ad_template_image_briefs
  add column if not exists card_image_path text;

comment on column research.ad_template_image_briefs.card_image_path is
  'Object path in the public template-cards bucket for this brief''s generated creative (null until generated).';

-- Public bucket so the gallery can load creatives without workspace auth.
insert into storage.buckets (id, name, public)
values ('template-cards', 'template-cards', true)
on conflict (id) do nothing;
