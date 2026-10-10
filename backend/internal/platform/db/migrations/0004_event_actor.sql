-- +goose Up
ALTER TABLE events ADD COLUMN actor text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE events DROP COLUMN actor;
