ALTER TABLE generation_jobs
  ADD COLUMN dispatch_lease_id uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN error_detail text;

CREATE INDEX generation_jobs_active_lease_idx
  ON generation_jobs (lease_expires_at)
  WHERE status IN ('dispatching', 'running', 'uploading');
