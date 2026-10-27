-- +goose NO TRANSACTION
-- +goose Up
-- Older rows may hold several reviews of one climber on one route; the newest one stays.
-- +goose StatementBegin
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  DELETE FROM ratings r USING ratings newer
    WHERE r."user" IS NOT NULL AND r."user" = newer."user" AND r.route_id = newer.route_id
      AND (r.created, r.id) < (newer.created, newer.id);
END $$;
-- +goose StatementEnd
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ratings_route_user_idx ON ratings (route_id, "user") WHERE "user" IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ratings_route_user_idx;
