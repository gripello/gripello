-- +goose Up
ALTER TABLE server_logs ADD COLUMN weight integer NOT NULL DEFAULT 1;
ALTER TABLE issue_alerts ADD COLUMN alerted_count integer NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE issue_alerts DROP COLUMN alerted_count;
ALTER TABLE server_logs DROP COLUMN weight;
