-- +goose Up
ALTER TABLE settings ADD COLUMN legal_name text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE settings DROP COLUMN legal_name;
