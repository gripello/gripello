-- +goose Up

CREATE TABLE mfa_challenges (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('login', 'passkey')),
  "user" text REFERENCES users ON DELETE CASCADE,
  method text NOT NULL DEFAULT '',
  data jsonb
);
CREATE INDEX mfa_challenges_created_idx ON mfa_challenges (created);

-- +goose Down
DROP TABLE mfa_challenges;
