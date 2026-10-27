-- +goose Up
ALTER TABLE settings DROP COLUMN floor_plan;

-- +goose Down
ALTER TABLE settings ADD COLUMN floor_plan text NOT NULL DEFAULT '';
