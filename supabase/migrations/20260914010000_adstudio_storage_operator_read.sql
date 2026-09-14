-- Keep workspace-artifacts reads aligned with the write authorization model.
-- Platform operators may save artifacts for any workspace without a local
-- membership, so they must also be able to read and sign those artifacts.
-- This is intentionally a forward-only policy correction; existing storage
-- objects and paths remain unchanged.

drop policy if exists workspace_artifacts_read on storage.objects;

create policy workspace_artifacts_read on storage.objects
  for select to authenticated using (
    bucket_id = 'workspace-artifacts'
    and private.adstudio_has_workspace_access(
      private.workspace_id_from_storage_path(name)
    )
  );
