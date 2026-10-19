-- +goose Up
CREATE INDEX users_lower_email_idx ON users (lower(email));

CREATE INDEX ticks_route_date_idx ON ticks (route, date) INCLUDE ("user", type, grade, grade_system, grade_index, created);
DROP INDEX ticks_route_idx;

CREATE INDEX ratings_gym_created_idx ON ratings (gym, created DESC, id);

CREATE INDEX audit_logs_gym_created_idx ON audit_logs (gym, created DESC, id DESC);
CREATE INDEX audit_logs_action_created_idx ON audit_logs (action, created);
DROP INDEX audit_logs_action_idx;

CREATE INDEX server_logs_warn_time_idx ON server_logs (time DESC, id DESC) WHERE severity >= 4;

CREATE OR REPLACE VIEW friend_ticks AS
SELECT ticks.id, follows.follower AS viewer, ticks."user", ticks.route, ticks.route_name, ticks.type, ticks.attempts,
  ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created
FROM follows
JOIN ticks ON ticks."user" = follows.followee
JOIN users ON users.id = ticks."user"
LEFT JOIN routes ON routes.id = ticks.route
LEFT JOIN gyms ON gyms.id = routes.gym
WHERE follows.status = 'accepted' AND users.ticks_private = false
  AND (routes.id IS NULL OR (gyms.active AND NOT gyms.hidden) OR gym_visible(routes.gym, follows.follower));

-- +goose Down
CREATE OR REPLACE VIEW friend_ticks AS
SELECT ticks.id, follows.follower AS viewer, ticks."user", ticks.route, ticks.route_name, ticks.type, ticks.attempts,
  ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created
FROM follows
JOIN ticks ON ticks."user" = follows.followee
JOIN users ON users.id = ticks."user"
LEFT JOIN routes ON routes.id = ticks.route
WHERE follows.status = 'accepted' AND users.ticks_private = false
  AND (routes.id IS NULL OR gym_visible(routes.gym, follows.follower));

DROP INDEX server_logs_warn_time_idx;
CREATE INDEX audit_logs_action_idx ON audit_logs (action);
DROP INDEX audit_logs_action_created_idx;
DROP INDEX audit_logs_gym_created_idx;
DROP INDEX ratings_gym_created_idx;
CREATE INDEX ticks_route_idx ON ticks (route);
DROP INDEX ticks_route_date_idx;
DROP INDEX users_lower_email_idx;
