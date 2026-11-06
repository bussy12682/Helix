-- 002: durable execution-job and pipeline-run records.
-- Execution jobs and autonomous pipeline runs are written through on every
-- transition so interrupted work is detectable and recoverable on boot.
CREATE TABLE execution_jobs (
  id           text PRIMARY KEY,
  project_id   text NOT NULL,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL,
  completed_at timestamptz,
  doc          jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_jobs_project_idx ON execution_jobs (project_id);
CREATE INDEX execution_jobs_open_idx ON execution_jobs (project_id) WHERE completed_at IS NULL;

CREATE TABLE pipeline_runs (
  id         text PRIMARY KEY,
  project_id text NOT NULL,
  status     text NOT NULL,
  started_at timestamptz NOT NULL,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_runs_project_idx ON pipeline_runs (project_id);
