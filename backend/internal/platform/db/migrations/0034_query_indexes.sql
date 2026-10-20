-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_created_idx ON notifications (created);
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_unread_idx ON notifications ("user") WHERE NOT read;
DROP INDEX CONCURRENTLY IF EXISTS notifications_user_read_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS routes_created_active_idx ON routes (created) WHERE NOT archived;
CREATE INDEX CONCURRENTLY IF NOT EXISTS routes_gym_location_active_idx ON routes (gym, location) WHERE NOT archived;
DROP INDEX CONCURRENTLY IF EXISTS routes_archived_location_idx;
DROP INDEX CONCURRENTLY IF EXISTS routes_name_grade_anchor_idx;

DROP INDEX CONCURRENTLY IF EXISTS ratings_gym_idx;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_gym_idx;
DROP INDEX CONCURRENTLY IF EXISTS roles_permissions_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS reports_decided_at_idx ON reports (decided_at) WHERE decided_at IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS reports_decided_at_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS roles_permissions_idx ON roles USING gin (permissions);
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_gym_idx ON audit_logs (gym);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ratings_gym_idx ON ratings (gym);
CREATE INDEX CONCURRENTLY IF NOT EXISTS routes_name_grade_anchor_idx ON routes (name, grade_index, anchor_point);
CREATE INDEX CONCURRENTLY IF NOT EXISTS routes_archived_location_idx ON routes (archived, location);
DROP INDEX CONCURRENTLY IF EXISTS routes_gym_location_active_idx;
DROP INDEX CONCURRENTLY IF EXISTS routes_created_active_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_user_read_idx ON notifications ("user", read);
DROP INDEX CONCURRENTLY IF EXISTS notifications_unread_idx;
DROP INDEX CONCURRENTLY IF EXISTS notifications_created_idx;
