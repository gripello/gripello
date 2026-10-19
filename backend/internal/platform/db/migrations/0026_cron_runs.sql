-- +goose Up
CREATE TABLE cron_runs (
  name text NOT NULL,
  slot timestamptz NOT NULL,
  PRIMARY KEY (name, slot)
);

-- +goose Down
DROP TABLE cron_runs;
