-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
DO $$
DECLARE i text;
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR i IN SELECT c.relname FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
    WHERE NOT x.indisvalid AND c.relnamespace = current_schema()::regnamespace
    AND c.relname IN ('roles_id_gym_idx', 'routes_id_gym_idx', 'locations_id_gym_idx', 'walls_id_gym_idx', 'competition_categories_id_competition_idx', 'competition_entries_id_competition_idx', 'competition_routes_id_competition_idx')
  LOOP
    EXECUTE format('DROP INDEX %I', i);
  END LOOP;
END $$;
-- +goose StatementEnd
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS roles_id_gym_idx ON roles (id, gym);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS routes_id_gym_idx ON routes (id, gym);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS locations_id_gym_idx ON locations (id, gym);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS walls_id_gym_idx ON walls (id, gym);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS competition_categories_id_competition_idx ON competition_categories (id, competition);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS competition_entries_id_competition_idx ON competition_entries (id, competition);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS competition_routes_id_competition_idx ON competition_routes (id, competition);

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_gym_fkey;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_gym_fkey FOREIGN KEY (role, gym) REFERENCES roles (id, gym) ON DELETE RESTRICT NOT VALID;
-- +goose StatementEnd
ALTER TABLE memberships VALIDATE CONSTRAINT memberships_role_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_gym_fkey;
ALTER TABLE invites ADD CONSTRAINT invites_role_gym_fkey FOREIGN KEY (role, gym) REFERENCES roles (id, gym) ON DELETE CASCADE NOT VALID;
-- +goose StatementEnd
ALTER TABLE invites VALIDATE CONSTRAINT invites_role_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_route_id_gym_fkey;
ALTER TABLE ratings ADD CONSTRAINT ratings_route_id_gym_fkey FOREIGN KEY (route_id, gym) REFERENCES routes (id, gym) ON DELETE CASCADE NOT VALID;
-- +goose StatementEnd
ALTER TABLE ratings VALIDATE CONSTRAINT ratings_route_id_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_route_id_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE beta_videos DROP CONSTRAINT IF EXISTS beta_videos_route_gym_fkey;
ALTER TABLE beta_videos ADD CONSTRAINT beta_videos_route_gym_fkey FOREIGN KEY (route, gym) REFERENCES routes (id, gym) ON DELETE CASCADE NOT VALID;
-- +goose StatementEnd
ALTER TABLE beta_videos VALIDATE CONSTRAINT beta_videos_route_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE beta_videos DROP CONSTRAINT IF EXISTS beta_videos_route_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_location_gym_fkey;
ALTER TABLE routes ADD CONSTRAINT routes_location_gym_fkey FOREIGN KEY (location, gym) REFERENCES locations (id, gym) ON DELETE RESTRICT NOT VALID;
-- +goose StatementEnd
ALTER TABLE routes VALIDATE CONSTRAINT routes_location_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_location_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_wall_gym_fkey;
ALTER TABLE routes ADD CONSTRAINT routes_wall_gym_fkey FOREIGN KEY (wall, gym) REFERENCES walls (id, gym) ON DELETE SET NULL (wall) NOT VALID;
-- +goose StatementEnd
ALTER TABLE routes VALIDATE CONSTRAINT routes_wall_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_wall_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE walls DROP CONSTRAINT IF EXISTS walls_location_gym_fkey;
ALTER TABLE walls ADD CONSTRAINT walls_location_gym_fkey FOREIGN KEY (location, gym) REFERENCES locations (id, gym) ON DELETE RESTRICT NOT VALID;
-- +goose StatementEnd
ALTER TABLE walls VALIDATE CONSTRAINT walls_location_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE walls DROP CONSTRAINT IF EXISTS walls_location_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_location_gym_fkey;
ALTER TABLE competitions ADD CONSTRAINT competitions_location_gym_fkey FOREIGN KEY (location, gym) REFERENCES locations (id, gym) ON DELETE RESTRICT NOT VALID;
-- +goose StatementEnd
ALTER TABLE competitions VALIDATE CONSTRAINT competitions_location_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_location_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_route_gym_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_route_gym_fkey FOREIGN KEY (route, gym) REFERENCES routes (id, gym) ON DELETE CASCADE NOT VALID;
-- +goose StatementEnd
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_route_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_route_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_wall_gym_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_wall_gym_fkey FOREIGN KEY (wall, gym) REFERENCES walls (id, gym) ON DELETE SET NULL (wall) NOT VALID;
-- +goose StatementEnd
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_wall_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_wall_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_location_gym_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_location_gym_fkey FOREIGN KEY (location, gym) REFERENCES locations (id, gym) ON DELETE SET NULL (location) NOT VALID;
-- +goose StatementEnd
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_location_gym_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_location_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_category_competition_fkey;
ALTER TABLE competition_entries ADD CONSTRAINT competition_entries_category_competition_fkey FOREIGN KEY (category, competition) REFERENCES competition_categories (id, competition) ON DELETE RESTRICT NOT VALID;
-- +goose StatementEnd
ALTER TABLE competition_entries VALIDATE CONSTRAINT competition_entries_category_competition_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_category_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_scores DROP CONSTRAINT IF EXISTS competition_scores_entry_competition_fkey;
ALTER TABLE competition_scores ADD CONSTRAINT competition_scores_entry_competition_fkey FOREIGN KEY (entry, competition) REFERENCES competition_entries (id, competition) ON DELETE CASCADE NOT VALID;
-- +goose StatementEnd
ALTER TABLE competition_scores VALIDATE CONSTRAINT competition_scores_entry_competition_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_scores DROP CONSTRAINT IF EXISTS competition_scores_entry_fkey;
-- +goose StatementEnd

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_scores DROP CONSTRAINT IF EXISTS competition_scores_comp_route_competition_fkey;
ALTER TABLE competition_scores ADD CONSTRAINT competition_scores_comp_route_competition_fkey FOREIGN KEY (comp_route, competition) REFERENCES competition_routes (id, competition) ON DELETE CASCADE NOT VALID;
-- +goose StatementEnd
ALTER TABLE competition_scores VALIDATE CONSTRAINT competition_scores_comp_route_competition_fkey;
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_scores DROP CONSTRAINT IF EXISTS competition_scores_comp_route_fkey;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE memberships ADD CONSTRAINT memberships_role_fkey FOREIGN KEY (role) REFERENCES roles (id) ON DELETE RESTRICT;
ALTER TABLE memberships DROP CONSTRAINT memberships_role_gym_fkey;
ALTER TABLE invites ADD CONSTRAINT invites_role_fkey FOREIGN KEY (role) REFERENCES roles (id) ON DELETE CASCADE;
ALTER TABLE invites DROP CONSTRAINT invites_role_gym_fkey;
ALTER TABLE ratings ADD CONSTRAINT ratings_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE CASCADE;
ALTER TABLE ratings DROP CONSTRAINT ratings_route_id_gym_fkey;
ALTER TABLE beta_videos ADD CONSTRAINT beta_videos_route_fkey FOREIGN KEY (route) REFERENCES routes (id) ON DELETE CASCADE;
ALTER TABLE beta_videos DROP CONSTRAINT beta_videos_route_gym_fkey;
ALTER TABLE routes ADD CONSTRAINT routes_location_fkey FOREIGN KEY (location) REFERENCES locations (id) ON DELETE RESTRICT;
ALTER TABLE routes DROP CONSTRAINT routes_location_gym_fkey;
ALTER TABLE routes ADD CONSTRAINT routes_wall_fkey FOREIGN KEY (wall) REFERENCES walls (id) ON DELETE SET NULL;
ALTER TABLE routes DROP CONSTRAINT routes_wall_gym_fkey;
ALTER TABLE walls ADD CONSTRAINT walls_location_fkey FOREIGN KEY (location) REFERENCES locations (id) ON DELETE RESTRICT;
ALTER TABLE walls DROP CONSTRAINT walls_location_gym_fkey;
ALTER TABLE competitions ADD CONSTRAINT competitions_location_fkey FOREIGN KEY (location) REFERENCES locations (id) ON DELETE RESTRICT;
ALTER TABLE competitions DROP CONSTRAINT competitions_location_gym_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_route_fkey FOREIGN KEY (route) REFERENCES routes (id) ON DELETE CASCADE;
ALTER TABLE tasks DROP CONSTRAINT tasks_route_gym_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_wall_fkey FOREIGN KEY (wall) REFERENCES walls (id) ON DELETE SET NULL;
ALTER TABLE tasks DROP CONSTRAINT tasks_wall_gym_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_location_fkey FOREIGN KEY (location) REFERENCES locations (id) ON DELETE SET NULL;
ALTER TABLE tasks DROP CONSTRAINT tasks_location_gym_fkey;
ALTER TABLE competition_entries ADD CONSTRAINT competition_entries_category_fkey FOREIGN KEY (category) REFERENCES competition_categories (id) ON DELETE RESTRICT;
ALTER TABLE competition_entries DROP CONSTRAINT competition_entries_category_competition_fkey;
ALTER TABLE competition_scores ADD CONSTRAINT competition_scores_entry_fkey FOREIGN KEY (entry) REFERENCES competition_entries (id) ON DELETE CASCADE;
ALTER TABLE competition_scores DROP CONSTRAINT competition_scores_entry_competition_fkey;
ALTER TABLE competition_scores ADD CONSTRAINT competition_scores_comp_route_fkey FOREIGN KEY (comp_route) REFERENCES competition_routes (id) ON DELETE CASCADE;
ALTER TABLE competition_scores DROP CONSTRAINT competition_scores_comp_route_competition_fkey;
DROP INDEX IF EXISTS roles_id_gym_idx;
DROP INDEX IF EXISTS routes_id_gym_idx;
DROP INDEX IF EXISTS locations_id_gym_idx;
DROP INDEX IF EXISTS walls_id_gym_idx;
DROP INDEX IF EXISTS competition_categories_id_competition_idx;
DROP INDEX IF EXISTS competition_entries_id_competition_idx;
DROP INDEX IF EXISTS competition_routes_id_competition_idx;
