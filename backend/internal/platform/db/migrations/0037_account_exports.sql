-- +goose Up
CREATE TABLE account_exports (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  "user" text REFERENCES users(id) ON DELETE SET NULL,
  token_hash text UNIQUE,
  file text,
  expires_at timestamptz NOT NULL,
  failure text CHECK (failure IN ('too_large')),
  CHECK (failure IS NOT NULL OR (token_hash IS NOT NULL AND file IS NOT NULL))
);
CREATE INDEX account_exports_user_idx ON account_exports ("user");
CREATE INDEX account_exports_expires_at_idx ON account_exports (expires_at);

-- +goose Down
DROP TABLE account_exports;
