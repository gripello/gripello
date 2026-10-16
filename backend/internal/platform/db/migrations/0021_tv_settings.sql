-- +goose Up
ALTER TABLE gyms ADD COLUMN tv_settings jsonb;

-- +goose Down
ALTER TABLE gyms DROP COLUMN tv_settings;
