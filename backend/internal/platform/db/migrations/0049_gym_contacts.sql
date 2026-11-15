-- +goose Up
ALTER TABLE gyms ADD COLUMN contacts jsonb NOT NULL DEFAULT '[]';
ALTER TABLE gyms ADD COLUMN report_email text NOT NULL DEFAULT '';
UPDATE gyms SET report_email = contact_email WHERE contact_email <> '';

-- +goose Down
ALTER TABLE gyms DROP COLUMN report_email;
ALTER TABLE gyms DROP COLUMN contacts;
