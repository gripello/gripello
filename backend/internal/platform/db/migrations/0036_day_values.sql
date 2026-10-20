-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user_badges' AND column_name = 'earned_on') = 'timestamp with time zone' THEN
    ALTER TABLE user_badges ALTER COLUMN earned_on TYPE date USING (earned_on AT TIME ZONE 'UTC')::date;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'tasks' AND column_name = 'due_date') = 'timestamp with time zone' THEN
    ALTER TABLE tasks ALTER COLUMN due_date TYPE date USING (due_date AT TIME ZONE 'UTC')::date;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'seasons' AND column_name = 'starts_at') = 'timestamp with time zone' THEN
    ALTER TABLE seasons ALTER COLUMN starts_at TYPE date USING (starts_at AT TIME ZONE 'UTC')::date,
      ALTER COLUMN ends_at TYPE date USING (ends_at AT TIME ZONE 'UTC')::date;
  END IF;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION sync_day_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ticks' THEN
    NEW.day = (NEW.date AT TIME ZONE 'UTC')::date;
  ELSE
    NEW.screw_day = (NEW.screw_date AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN NEW;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ticks' AND column_name = 'date') = 'timestamp with time zone' THEN
    ALTER TABLE ticks ADD COLUMN IF NOT EXISTS day date;
    DROP TRIGGER IF EXISTS ticks_sync_day ON ticks;
    CREATE TRIGGER ticks_sync_day BEFORE INSERT OR UPDATE OF date ON ticks FOR EACH ROW EXECUTE FUNCTION sync_day_columns();
  END IF;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'routes' AND column_name = 'screw_date') = 'timestamp with time zone' THEN
    ALTER TABLE routes ADD COLUMN IF NOT EXISTS screw_day date;
    DROP TRIGGER IF EXISTS routes_sync_screw_day ON routes;
    CREATE TRIGGER routes_sync_screw_day BEFORE INSERT OR UPDATE OF screw_date ON routes FOR EACH ROW EXECUTE FUNCTION sync_day_columns();
  END IF;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE last text; upto text;
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ticks' AND column_name = 'date') = 'timestamp with time zone' THEN
    last := '';
    LOOP
      SELECT max(id) INTO upto FROM (SELECT id FROM ticks WHERE id > last ORDER BY id LIMIT 5000) b;
      EXIT WHEN upto IS NULL;
      UPDATE ticks SET day = (date AT TIME ZONE 'UTC')::date WHERE id > last AND id <= upto AND day IS NULL;
      last := upto;
      COMMIT;
    END LOOP;
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'routes' AND column_name = 'screw_date') = 'timestamp with time zone' THEN
    last := '';
    LOOP
      SELECT max(id) INTO upto FROM (SELECT id FROM routes WHERE id > last ORDER BY id LIMIT 5000) b;
      EXIT WHEN upto IS NULL;
      UPDATE routes SET screw_day = (screw_date AT TIME ZONE 'UTC')::date
        WHERE id > last AND id <= upto AND screw_day IS DISTINCT FROM (screw_date AT TIME ZONE 'UTC')::date;
      last := upto;
      COMMIT;
    END LOOP;
  END IF;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ticks' AND column_name = 'date') = 'timestamp with time zone' THEN
    ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_day_not_null;
    ALTER TABLE ticks ADD CONSTRAINT ticks_day_not_null CHECK (day IS NOT NULL) NOT VALID;
  END IF;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ticks' AND column_name = 'date') = 'timestamp with time zone' THEN
    ALTER TABLE ticks VALIDATE CONSTRAINT ticks_day_not_null;
  END IF;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ticks' AND column_name = 'date') = 'timestamp with time zone' THEN
    DROP VIEW friend_ticks;
    DROP VIEW average_rating;
    DROP TRIGGER ticks_sync_day ON ticks;
    DROP TRIGGER routes_sync_screw_day ON routes;
    ALTER TABLE ticks DROP COLUMN date;
    ALTER TABLE ticks RENAME COLUMN day TO date;
    ALTER TABLE ticks ALTER COLUMN date SET NOT NULL;
    ALTER TABLE ticks DROP CONSTRAINT ticks_day_not_null;
    ALTER TABLE routes DROP COLUMN screw_date;
    ALTER TABLE routes RENAME COLUMN screw_day TO screw_date;
    CREATE VIEW friend_ticks AS
    SELECT ticks.id, follows.follower AS viewer, ticks."user", ticks.route, ticks.route_name, ticks.type, ticks.attempts,
      ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created
    FROM follows
    JOIN ticks ON ticks."user" = follows.followee
    JOIN users ON users.id = ticks."user"
    LEFT JOIN routes ON routes.id = ticks.route
    LEFT JOIN gyms ON gyms.id = routes.gym
    WHERE follows.status = 'accepted' AND users.ticks_private = false
      AND (routes.id IS NULL OR (gyms.active AND NOT gyms.hidden) OR gym_visible(routes.gym, follows.follower));
    CREATE VIEW average_rating AS
    SELECT routes.*,
      (SELECT AVG(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::double precision AS average_rating,
      (SELECT COUNT(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::integer AS ratings_count
    FROM routes;
  END IF;
END $$;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS sync_day_columns();

-- +goose StatementBegin
DO $$
DECLARE i text;
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR i IN SELECT c.relname FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
    WHERE NOT x.indisvalid AND c.relnamespace = current_schema()::regnamespace AND c.relname IN ('ticks_user_date_idx', 'ticks_route_date_idx')
  LOOP
    EXECUTE format('DROP INDEX %I', i);
  END LOOP;
END $$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS ticks_user_date_idx ON ticks ("user", date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ticks_route_date_idx ON ticks (route, date) INCLUDE ("user", type, grade, grade_system, grade_index, created);

-- +goose Down
ALTER TABLE seasons ALTER COLUMN starts_at TYPE timestamptz USING starts_at::timestamp AT TIME ZONE 'UTC',
  ALTER COLUMN ends_at TYPE timestamptz USING ends_at::timestamp AT TIME ZONE 'UTC';
ALTER TABLE tasks ALTER COLUMN due_date TYPE timestamptz USING (due_date + time '12:00') AT TIME ZONE 'UTC';
ALTER TABLE user_badges ALTER COLUMN earned_on TYPE timestamptz USING (earned_on + time '12:00') AT TIME ZONE 'UTC';
-- +goose StatementBegin
DROP VIEW friend_ticks;
DROP VIEW average_rating;
ALTER TABLE ticks ALTER COLUMN date TYPE timestamptz USING (date + time '12:00') AT TIME ZONE 'UTC';
ALTER TABLE routes ALTER COLUMN screw_date TYPE timestamptz USING (screw_date + time '12:00') AT TIME ZONE 'UTC';
CREATE VIEW friend_ticks AS
SELECT ticks.id, follows.follower AS viewer, ticks."user", ticks.route, ticks.route_name, ticks.type, ticks.attempts,
  ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created
FROM follows
JOIN ticks ON ticks."user" = follows.followee
JOIN users ON users.id = ticks."user"
LEFT JOIN routes ON routes.id = ticks.route
LEFT JOIN gyms ON gyms.id = routes.gym
WHERE follows.status = 'accepted' AND users.ticks_private = false
  AND (routes.id IS NULL OR (gyms.active AND NOT gyms.hidden) OR gym_visible(routes.gym, follows.follower));
CREATE VIEW average_rating AS
SELECT routes.*,
  (SELECT AVG(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::double precision AS average_rating,
  (SELECT COUNT(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::integer AS ratings_count
FROM routes;
-- +goose StatementEnd
