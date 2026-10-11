-- +goose Up
CREATE TABLE replicas (
  name text PRIMARY KEY,
  version text NOT NULL,
  role text NOT NULL,
  started timestamptz NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(),
  realtime_clients integer NOT NULL DEFAULT 0,
  memory_bytes bigint NOT NULL DEFAULT 0
);
CREATE TABLE server_logs (
  id bigserial PRIMARY KEY,
  time timestamptz NOT NULL,
  replica text NOT NULL,
  severity integer NOT NULL,
  level text NOT NULL,
  message text NOT NULL,
  attrs jsonb
);
CREATE INDEX server_logs_time ON server_logs (time DESC);
CREATE INDEX server_logs_severity_time ON server_logs (severity, time DESC);

-- +goose Down
DROP TABLE server_logs;
DROP TABLE replicas;
