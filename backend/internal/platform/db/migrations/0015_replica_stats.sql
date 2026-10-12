-- +goose Up
ALTER TABLE replicas
  ADD COLUMN goroutines integer NOT NULL DEFAULT 0,
  ADD COLUMN heap_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN gc_pause_ms double precision NOT NULL DEFAULT 0,
  ADD COLUMN db_conns_in_use integer NOT NULL DEFAULT 0,
  ADD COLUMN db_conns_max integer NOT NULL DEFAULT 0,
  ADD COLUMN db_waits integer NOT NULL DEFAULT 0,
  ADD COLUMN db_wait_ms double precision NOT NULL DEFAULT 0,
  ADD COLUMN realtime_dropped integer NOT NULL DEFAULT 0,
  ADD COLUMN bus_lag_ms double precision NOT NULL DEFAULT 0,
  ADD COLUMN bus_queue_max integer NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE replicas
  DROP COLUMN goroutines, DROP COLUMN heap_bytes, DROP COLUMN gc_pause_ms, DROP COLUMN db_conns_in_use,
  DROP COLUMN db_conns_max, DROP COLUMN db_waits, DROP COLUMN db_wait_ms, DROP COLUMN realtime_dropped,
  DROP COLUMN bus_lag_ms, DROP COLUMN bus_queue_max;
