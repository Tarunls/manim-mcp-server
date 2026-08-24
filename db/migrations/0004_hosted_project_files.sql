ALTER TABLE generation_jobs ADD COLUMN input jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE project_files (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('licensed_asset', 'review_clean', 'review_annotated')),
  bucket text NOT NULL,
  object_name text NOT NULL,
  generation bigint NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  checksum text NOT NULL,
  checksum_algorithm text NOT NULL DEFAULT 'crc32c',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_name, generation)
);

CREATE INDEX project_files_owner_project_idx
  ON project_files (owner_id, project_id, created_at DESC);
