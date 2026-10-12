-- +goose Up
ALTER TABLE server_logs ADD COLUMN fingerprint text;
CREATE INDEX server_logs_fingerprint_time ON server_logs (fingerprint, time DESC) WHERE fingerprint IS NOT NULL;
CREATE TABLE issue_alerts (
  fingerprint text PRIMARY KEY,
  alerted_at timestamptz NOT NULL
);

-- +goose Down
DROP TABLE issue_alerts;
DROP INDEX server_logs_fingerprint_time;
ALTER TABLE server_logs DROP COLUMN fingerprint;
