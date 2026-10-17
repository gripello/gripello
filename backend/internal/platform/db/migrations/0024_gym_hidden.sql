-- +goose Up
ALTER TABLE gyms ADD COLUMN hidden boolean NOT NULL DEFAULT false;

-- +goose StatementBegin
CREATE FUNCTION gym_visible(gym_id text, viewer text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT g.active AND NOT g.hidden FROM gyms g WHERE g.id = gym_id), true)
    OR EXISTS (SELECT 1 FROM users WHERE id = viewer AND platform_admin)
    OR EXISTS (SELECT 1 FROM memberships WHERE gym = gym_id AND "user" = viewer)
$$;
-- +goose StatementEnd

CREATE OR REPLACE VIEW friend_ticks AS
SELECT ticks.id, follows.follower AS viewer, ticks."user", ticks.route, ticks.route_name, ticks.type, ticks.attempts,
  ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created
FROM follows
JOIN ticks ON ticks."user" = follows.followee
JOIN users ON users.id = ticks."user"
LEFT JOIN routes ON routes.id = ticks.route
WHERE follows.status = 'accepted' AND users.ticks_private = false
  AND (routes.id IS NULL OR gym_visible(routes.gym, follows.follower));

-- +goose Down
CREATE OR REPLACE VIEW friend_ticks AS
SELECT ticks.id, follows.follower AS viewer, ticks."user", ticks.route, ticks.route_name, ticks.type, ticks.attempts,
  ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created
FROM follows
JOIN ticks ON ticks."user" = follows.followee
JOIN users ON users.id = ticks."user"
WHERE follows.status = 'accepted' AND users.ticks_private = false;

DROP FUNCTION gym_visible(text, text);
ALTER TABLE gyms DROP COLUMN hidden;
