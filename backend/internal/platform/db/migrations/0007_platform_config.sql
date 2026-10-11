-- +goose Up
-- Admin-only operator settings; never on settings, which GET /settings serves publicly.
CREATE TABLE platform_config (
  id text PRIMARY KEY DEFAULT 'platformconfig' CHECK (id = 'platformconfig'),
  updated timestamptz NOT NULL DEFAULT now(),
  smtp_host text NOT NULL DEFAULT '',
  smtp_port integer NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_username text NOT NULL DEFAULT '',
  smtp_password text NOT NULL DEFAULT '',
  smtp_tls boolean NOT NULL DEFAULT true,
  sender_address text NOT NULL DEFAULT '',
  sender_name text NOT NULL DEFAULT '',
  log_level text NOT NULL DEFAULT 'info' CHECK (log_level IN ('debug', 'info', 'warn', 'error'))
);
INSERT INTO platform_config DEFAULT VALUES;

-- +goose Down
DROP TABLE platform_config;
