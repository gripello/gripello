-- +goose Up
CREATE TABLE backup_settings (
  id text PRIMARY KEY DEFAULT 'backupsettings' CHECK (id = 'backupsettings'),
  updated timestamptz NOT NULL DEFAULT now(),
  keep integer NOT NULL DEFAULT 7 CHECK (keep BETWEEN 0 AND 365),
  include_storage boolean NOT NULL DEFAULT true
);
INSERT INTO backup_settings DEFAULT VALUES;

-- +goose Down
DROP TABLE backup_settings;
