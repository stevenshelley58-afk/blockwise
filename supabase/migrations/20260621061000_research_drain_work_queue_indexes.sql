create index if not exists work_queue_drain_open_idx
  on research.work_queue (job_type, status, created_at)
  where status in ('pending', 'claimed', 'failed', 'blocked');

create index if not exists work_queue_drain_complete_idx
  on research.work_queue (job_type, completed_at desc, created_at)
  where status = 'complete';
