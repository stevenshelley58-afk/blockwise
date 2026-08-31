-- Restore the explicit status constraint for databases that already applied
-- 202608250001 before that migration was corrected.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.adstudio_customer_image_uploads'::regclass
       and conname = 'adstudio_customer_image_uploads_status_check'
  ) then
    alter table public.adstudio_customer_image_uploads
      add constraint adstudio_customer_image_uploads_status_check
      check (status in ('pending', 'finalizing', 'deleting', 'finalized'));
  end if;
end;
$$;
