-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS streamed_at timestamptz;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_record_created_idx ON audit_logs (record_id, created);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_record_created_idx;
ALTER TABLE sessions DROP COLUMN IF EXISTS streamed_at;
