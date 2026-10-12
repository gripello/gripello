-- +goose Up
ALTER TABLE server_logs
  ADD COLUMN actor text GENERATED ALWAYS AS (NULLIF(attrs->>'user', '')) STORED,
  ADD COLUMN client boolean GENERATED ALWAYS AS (attrs->>'source' = 'client') STORED;

-- +goose Down
ALTER TABLE server_logs DROP COLUMN client, DROP COLUMN actor;
