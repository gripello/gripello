-- +goose Up
CREATE TABLE request_stats (
  bucket timestamptz NOT NULL,
  method text NOT NULL,
  pattern text NOT NULL,
  total bigint NOT NULL DEFAULT 0,
  client_errors bigint NOT NULL DEFAULT 0,
  server_errors bigint NOT NULL DEFAULT 0,
  duration_ms double precision NOT NULL DEFAULT 0,
  b0 bigint NOT NULL DEFAULT 0, b1 bigint NOT NULL DEFAULT 0, b2 bigint NOT NULL DEFAULT 0, b3 bigint NOT NULL DEFAULT 0,
  b4 bigint NOT NULL DEFAULT 0, b5 bigint NOT NULL DEFAULT 0, b6 bigint NOT NULL DEFAULT 0, b7 bigint NOT NULL DEFAULT 0,
  b8 bigint NOT NULL DEFAULT 0, b9 bigint NOT NULL DEFAULT 0, b10 bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, method, pattern)
);
CREATE TABLE visitor_salts (day date PRIMARY KEY, salt text NOT NULL);
CREATE TABLE request_visitors (day date NOT NULL, hash bytea NOT NULL, PRIMARY KEY (day, hash));

-- +goose Down
DROP TABLE request_visitors;
DROP TABLE visitor_salts;
DROP TABLE request_stats;
