-- +goose Up
ALTER TABLE backup_settings
  ADD COLUMN hour smallint NOT NULL DEFAULT 2 CHECK (hour BETWEEN 0 AND 23),
  ADD COLUMN last_run timestamptz,
  ADD COLUMN last_error text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE backup_settings DROP COLUMN hour, DROP COLUMN last_run, DROP COLUMN last_error;
