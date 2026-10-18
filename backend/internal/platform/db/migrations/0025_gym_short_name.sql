-- +goose Up
ALTER TABLE gyms ADD COLUMN short_name text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE gyms DROP COLUMN short_name;
