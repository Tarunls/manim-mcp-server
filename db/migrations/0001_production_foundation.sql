CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'staff', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique
  ON app_users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  document jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS projects_owner_updated_idx
  ON projects (owner_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS billing_profiles (
  user_id text PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'creator', 'pro')),
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'dispatching', 'running', 'uploading', 'complete', 'failed', 'cancelled')),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 12000),
  renderer text NOT NULL CHECK (renderer IN ('manim', 'remotion', 'composite')),
  effort text NOT NULL CHECK (effort IN ('quick', 'balanced', 'thorough')),
  idempotency_key text NOT NULL,
  template_version text NOT NULL,
  e2b_sandbox_id text,
  callback_token_hash text NOT NULL,
  reserved_credits integer NOT NULL CHECK (reserved_credits >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  error_code text,
  error_message text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS generation_jobs_owner_updated_idx
  ON generation_jobs (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_status_queued_idx
  ON generation_jobs (status, queued_at) WHERE status IN ('queued', 'dispatching', 'running');

CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  amount integer NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('generation_reservation', 'generation_refund', 'subscription_grant', 'manual_adjustment')),
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON credit_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('video', 'poster', 'contact_sheet', 'source_archive', 'metadata')),
  bucket text NOT NULL,
  object_name text NOT NULL,
  generation bigint,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind),
  UNIQUE (bucket, object_name, generation)
);

CREATE INDEX IF NOT EXISTS artifacts_owner_project_idx
  ON artifacts (owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_events_job_id_idx ON job_events (job_id, id);
CREATE INDEX IF NOT EXISTS job_events_owner_id_idx ON job_events (owner_id, id);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  actor_user_id text REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  request_id text,
  ip_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_actor_created_idx
  ON audit_events (actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events (created_at) WHERE published_at IS NULL;
