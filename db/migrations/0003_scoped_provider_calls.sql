CREATE TABLE IF NOT EXISTS job_provider_calls (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS job_provider_calls_job_provider_idx
  ON job_provider_calls (job_id, provider, created_at);
