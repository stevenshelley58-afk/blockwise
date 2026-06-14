alter table if exists research.ad_template_image_briefs
  add column if not exists card_image_path text;

comment on column research.ad_template_image_briefs.card_image_path is
  'Object path in the public template-cards bucket for this brief''s generated creative (null until generated).';

insert into storage.buckets (id, name, public)
values ('template-cards', 'template-cards', true)
on conflict (id) do nothing;;
