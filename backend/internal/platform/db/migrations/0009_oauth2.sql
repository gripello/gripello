-- +goose Up
-- Secrets (client_secret, Apple private_key) are sealed with secretbox and never returned by the API.
CREATE TABLE oauth2_providers (
  provider text PRIMARY KEY CHECK (provider IN ('google', 'apple', 'microsoft', 'oidc')),
  updated timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT false,
  client_id text NOT NULL DEFAULT '',
  client_secret text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  issuer_url text NOT NULL DEFAULT '',
  tenant text NOT NULL DEFAULT '',
  team_id text NOT NULL DEFAULT '',
  key_id text NOT NULL DEFAULT '',
  private_key text NOT NULL DEFAULT ''
);
CREATE TABLE user_identities (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  email text NOT NULL DEFAULT '',
  UNIQUE (provider, subject),
  UNIQUE ("user", provider)
);
ALTER TABLE mfa_challenges DROP CONSTRAINT mfa_challenges_kind_check,
  ADD CONSTRAINT mfa_challenges_kind_check CHECK (kind IN ('login', 'passkey', 'oauth2_state', 'oauth2'));

-- +goose Down
DELETE FROM mfa_challenges WHERE kind IN ('oauth2_state', 'oauth2');
ALTER TABLE mfa_challenges DROP CONSTRAINT mfa_challenges_kind_check,
  ADD CONSTRAINT mfa_challenges_kind_check CHECK (kind IN ('login', 'passkey'));
DROP TABLE user_identities;
DROP TABLE oauth2_providers;
