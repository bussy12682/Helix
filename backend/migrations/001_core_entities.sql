-- 001: core entity tables. Documents are JSONB copies of the in-memory records;
-- primary/foreign keys and indexes cover every access path the API uses.
CREATE TABLE users (
  id         text PRIMARY KEY,
  email      text NOT NULL,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token      text PRIMARY KEY,
  user_id    text NOT NULL,
  expires_at timestamptz NOT NULL,
  doc        jsonb NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE projects (
  id       text PRIMARY KEY,
  owner_id text NOT NULL,
  doc      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_idx ON projects (owner_id);

CREATE TABLE password_resets (
  token      text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  doc        jsonb NOT NULL
);

CREATE TABLE workflows (
  id         text PRIMARY KEY,
  project_id text NOT NULL,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflows_project_idx ON workflows (project_id);

CREATE TABLE workspaces (
  project_id text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE traces (
  workflow_id text PRIMARY KEY,
  spans       jsonb NOT NULL
);

CREATE TABLE taskflows (
  id         text PRIMARY KEY,
  project_id text NOT NULL,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX taskflows_project_idx ON taskflows (project_id);
