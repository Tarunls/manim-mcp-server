ALTER TABLE job_provider_calls ADD COLUMN model text;
ALTER TABLE job_provider_calls ADD COLUMN response_status integer;
ALTER TABLE job_provider_calls ADD COLUMN input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0);
ALTER TABLE job_provider_calls ADD COLUMN cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0);
ALTER TABLE job_provider_calls ADD COLUMN output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0);
ALTER TABLE job_provider_calls ADD COLUMN estimated_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_microusd >= 0);
ALTER TABLE job_provider_calls ADD COLUMN completed_at timestamptz;

CREATE INDEX job_provider_calls_cost_idx
  ON job_provider_calls (created_at, estimated_cost_microusd)
  WHERE provider = 'openai';
