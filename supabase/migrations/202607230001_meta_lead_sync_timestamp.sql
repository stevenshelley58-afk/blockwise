-- Track when the Meta lead sync last ran for a workspace.
-- Idempotent: the column was already applied directly to prod before this
-- migration file was committed, so guard with IF NOT EXISTS.
alter table public.workspaces
  add column if not exists last_meta_lead_sync_at timestamptz;
