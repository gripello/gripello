-- +goose Up
ALTER TABLE sessions ADD COLUMN reauthenticated_at timestamptz;

-- +goose Down
ALTER TABLE sessions DROP COLUMN reauthenticated_at;
