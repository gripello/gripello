-- +goose Up
CREATE TABLE usage_daily (
  day date NOT NULL,
  feature text NOT NULL,
  signed_in boolean NOT NULL,
  app boolean NOT NULL,
  requests bigint NOT NULL DEFAULT 0,
  people integer NOT NULL DEFAULT 0,
  device text NOT NULL DEFAULT 'other' CHECK (device IN ('phone', 'tablet', 'desktop', 'tv', 'other')),
  os text NOT NULL DEFAULT 'other' CHECK (os IN ('android', 'ios', 'macos', 'windows', 'linux', 'chromeos', 'other')),
  PRIMARY KEY (day, feature, signed_in, app, device, os)
);
-- Salted with the day's visitor salt; the nightly rollup counts and deletes them.
CREATE TABLE usage_people (
  day date NOT NULL,
  feature text NOT NULL,
  signed_in boolean NOT NULL,
  app boolean NOT NULL,
  hash bytea NOT NULL,
  device text NOT NULL DEFAULT 'other',
  os text NOT NULL DEFAULT 'other',
  PRIMARY KEY (day, feature, signed_in, app, device, os, hash)
);
CREATE TABLE product_daily (
  day date NOT NULL,
  metric text NOT NULL,
  value bigint NOT NULL,
  PRIMARY KEY (day, metric)
);

-- +goose Down
DROP TABLE product_daily;
DROP TABLE usage_people;
DROP TABLE usage_daily;
