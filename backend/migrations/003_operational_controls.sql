-- 003: operational governance records — token budgets and audit events.
CREATE TABLE budget_usage (
  scope_key  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id         text PRIMARY KEY,
  user_id    text,
  project_id text,
  type       text NOT NULL,
  created_at timestamptz NOT NULL,
  doc        jsonb NOT NULL
);
CREATE INDEX audit_events_user_idx ON audit_events (user_id, created_at DESC);
