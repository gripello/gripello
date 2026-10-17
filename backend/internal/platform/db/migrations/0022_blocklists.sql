-- +goose Up
ALTER TABLE platform_config
  ADD COLUMN blocked_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN allowed_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN protected_names text[] NOT NULL DEFAULT '{gripello,admin,administrator,moderator,support,official}';

-- notice holds the upstream license, downloaded with each list so the stored copy always carries it.
CREATE TABLE email_blocklist_sources (
  id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  attempted_at timestamptz,
  domain_count integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  notice text NOT NULL DEFAULT ''
);
INSERT INTO email_blocklist_sources (id) VALUES ('disposable-email-domains'), ('mailchecker');

CREATE TABLE disposable_domains (
  domain text NOT NULL,
  source text NOT NULL REFERENCES email_blocklist_sources (id) ON DELETE CASCADE,
  PRIMARY KEY (domain, source)
);
CREATE INDEX disposable_domains_source_idx ON disposable_domains (source);

-- +goose Down
DROP TABLE disposable_domains;
DROP TABLE email_blocklist_sources;
ALTER TABLE platform_config DROP COLUMN blocked_emails, DROP COLUMN allowed_emails, DROP COLUMN protected_names;
