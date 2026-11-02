-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS server_logs_req_time_idx ON server_logs ((attrs->>'req'), time DESC) WHERE attrs->>'req' IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS server_logs_actor_time_idx ON server_logs (actor, time DESC) WHERE actor IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS server_logs_actor_time_idx;
DROP INDEX CONCURRENTLY IF EXISTS server_logs_req_time_idx;
