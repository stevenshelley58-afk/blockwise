-- Allow Hermes to move old blocked jobs out of the health-critical queue
-- without deleting diagnostic payloads.

alter table research.work_queue
  drop constraint if exists work_queue_status_check;

alter table research.work_queue
  add constraint work_queue_status_check
  check (status in ('pending', 'claimed', 'complete', 'failed', 'blocked', 'archived'));

notify pgrst, 'reload schema';
