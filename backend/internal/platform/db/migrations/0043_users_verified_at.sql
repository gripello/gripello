-- +goose Up
ALTER TABLE users ADD COLUMN verified_at timestamptz;
UPDATE users SET verified_at = created WHERE verified;

-- +goose StatementBegin
CREATE FUNCTION stamp_users_verified_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verified AND NEW.verified_at IS NULL THEN
    NEW.verified_at := now();
  END IF;
  RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER users_verified_at BEFORE INSERT OR UPDATE OF verified ON users
  FOR EACH ROW EXECUTE FUNCTION stamp_users_verified_at();

CREATE INDEX users_unverified_created_idx ON users (created) WHERE NOT verified AND verified_at IS NULL;

-- +goose Down
DROP INDEX users_unverified_created_idx;
DROP TRIGGER users_verified_at ON users;
DROP FUNCTION stamp_users_verified_at();
ALTER TABLE users DROP COLUMN verified_at;
