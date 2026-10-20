-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_lengths_check;
ALTER TABLE users ADD CONSTRAINT users_lengths_check CHECK (char_length(username) <= 150 AND char_length(firstname) <= 5000 AND char_length(name) <= 5000) NOT VALID;
-- +goose StatementEnd
ALTER TABLE users VALIDATE CONSTRAINT users_lengths_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_lengths_check;
ALTER TABLE invites ADD CONSTRAINT invites_lengths_check CHECK (char_length(firstname) <= 100 AND char_length(name) <= 100) NOT VALID;
-- +goose StatementEnd
ALTER TABLE invites VALIDATE CONSTRAINT invites_lengths_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE gyms DROP CONSTRAINT IF EXISTS gyms_amenities_check;
ALTER TABLE gyms ADD CONSTRAINT gyms_amenities_check CHECK (amenities <@ ARRAY['toilets','showers','changing_rooms','lockers','cafe','shop','rental','parking','bike_parking','public_transport','kids_area','training_area','outdoor_area','yoga','sauna','wheelchair','wifi']) NOT VALID;
-- +goose StatementEnd
ALTER TABLE gyms VALIDATE CONSTRAINT gyms_amenities_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_lengths_check;
ALTER TABLE roles ADD CONSTRAINT roles_lengths_check CHECK (char_length(name) <= 50 AND char_length(description) <= 200 AND char_length(color) <= 50) NOT VALID;
-- +goose StatementEnd
ALTER TABLE roles VALIDATE CONSTRAINT roles_lengths_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_name_check;
ALTER TABLE locations ADD CONSTRAINT locations_name_check CHECK (char_length(name) <= 100) NOT VALID;
-- +goose StatementEnd
ALTER TABLE locations VALIDATE CONSTRAINT locations_name_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE walls DROP CONSTRAINT IF EXISTS walls_name_check;
ALTER TABLE walls ADD CONSTRAINT walls_name_check CHECK (char_length(name) <= 100) NOT VALID;
-- +goose StatementEnd
ALTER TABLE walls VALIDATE CONSTRAINT walls_name_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_lengths_check;
ALTER TABLE routes ADD CONSTRAINT routes_lengths_check CHECK (char_length(name) <= 100 AND char_length(comment) <= 2000 AND char_length(grade) <= 20 AND char_length(grade_system) <= 30 AND char_length(color) <= 50) NOT VALID;
-- +goose StatementEnd
ALTER TABLE routes VALIDATE CONSTRAINT routes_lengths_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_grade_index_check;
ALTER TABLE routes ADD CONSTRAINT routes_grade_index_check CHECK (grade_index BETWEEN 0 AND 40) NOT VALID;
-- +goose StatementEnd
ALTER TABLE routes VALIDATE CONSTRAINT routes_grade_index_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_lengths_check;
ALTER TABLE ratings ADD CONSTRAINT ratings_lengths_check CHECK (char_length(grade) <= 20 AND char_length(grade_system) <= 30 AND char_length(comment) <= 5000) NOT VALID;
-- +goose StatementEnd
ALTER TABLE ratings VALIDATE CONSTRAINT ratings_lengths_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_rating_check;
ALTER TABLE ratings ADD CONSTRAINT ratings_rating_check CHECK (rating BETWEEN 0 AND 5) NOT VALID;
-- +goose StatementEnd
ALTER TABLE ratings VALIDATE CONSTRAINT ratings_rating_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_grade_index_check;
ALTER TABLE ratings ADD CONSTRAINT ratings_grade_index_check CHECK (grade_index BETWEEN 0 AND 40) NOT VALID;
-- +goose StatementEnd
ALTER TABLE ratings VALIDATE CONSTRAINT ratings_grade_index_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_attempts_check;
ALTER TABLE ticks ADD CONSTRAINT ticks_attempts_check CHECK (attempts BETWEEN 1 AND 999) NOT VALID;
-- +goose StatementEnd
ALTER TABLE ticks VALIDATE CONSTRAINT ticks_attempts_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_note_check;
ALTER TABLE ticks ADD CONSTRAINT ticks_note_check CHECK (char_length(note) <= 500) NOT VALID;
-- +goose StatementEnd
ALTER TABLE ticks VALIDATE CONSTRAINT ticks_note_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_grade_index_check;
ALTER TABLE ticks ADD CONSTRAINT ticks_grade_index_check CHECK (grade_index BETWEEN 0 AND 40) NOT VALID;
-- +goose StatementEnd
ALTER TABLE ticks VALIDATE CONSTRAINT ticks_grade_index_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_check;
ALTER TABLE seasons ADD CONSTRAINT seasons_check CHECK (ends_at >= starts_at AND char_length(name) <= 60) NOT VALID;
-- +goose StatementEnd
ALTER TABLE seasons VALIDATE CONSTRAINT seasons_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority BETWEEN 1 AND 4) NOT VALID;
-- +goose StatementEnd
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_priority_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_lengths_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_lengths_check CHECK (char_length(title) <= 200 AND char_length(description) <= 2000 AND char_length(resolution_note) <= 1000 AND char_length(grade) <= 10) NOT VALID;
-- +goose StatementEnd
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_lengths_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_check;
ALTER TABLE competitions ADD CONSTRAINT competitions_check CHECK (ends_at >= starts_at AND char_length(name) <= 200 AND char_length(description) <= 5000 AND char_length(registration_url) <= 500) NOT VALID;
-- +goose StatementEnd
ALTER TABLE competitions VALIDATE CONSTRAINT competitions_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_categories DROP CONSTRAINT IF EXISTS competition_categories_name_check;
ALTER TABLE competition_categories ADD CONSTRAINT competition_categories_name_check CHECK (char_length(name) <= 100) NOT VALID;
-- +goose StatementEnd
ALTER TABLE competition_categories VALIDATE CONSTRAINT competition_categories_name_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_display_name_check;
ALTER TABLE competition_entries ADD CONSTRAINT competition_entries_display_name_check CHECK (char_length(display_name) <= 60) NOT VALID;
-- +goose StatementEnd
ALTER TABLE competition_entries VALIDATE CONSTRAINT competition_entries_display_name_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_check;
ALTER TABLE follows ADD CONSTRAINT follows_check CHECK (follower <> followee) NOT VALID;
-- +goose StatementEnd
ALTER TABLE follows VALIDATE CONSTRAINT follows_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_check;
ALTER TABLE blocks ADD CONSTRAINT blocks_check CHECK (blocker <> blocked) NOT VALID;
-- +goose StatementEnd
ALTER TABLE blocks VALIDATE CONSTRAINT blocks_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_lengths_check;
ALTER TABLE reports ADD CONSTRAINT reports_lengths_check CHECK (char_length(explanation) <= 2000 AND char_length(notifier_name) <= 100 AND char_length(notifier_email) <= 254) NOT VALID;
-- +goose StatementEnd
ALTER TABLE reports VALIDATE CONSTRAINT reports_lengths_check;

-- +goose StatementBegin
SET LOCAL lock_timeout = '5s';
UPDATE sessions SET last_seen = updated WHERE last_seen IS NULL;
ALTER TABLE sessions ALTER COLUMN last_seen SET DEFAULT now(), ALTER COLUMN last_seen SET NOT NULL;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE sessions ALTER COLUMN last_seen DROP NOT NULL, ALTER COLUMN last_seen DROP DEFAULT;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_lengths_check;
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_check;
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_check;
ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_display_name_check;
ALTER TABLE competition_categories DROP CONSTRAINT IF EXISTS competition_categories_name_check;
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_lengths_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_check;
ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_grade_index_check;
ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_note_check;
ALTER TABLE ticks DROP CONSTRAINT IF EXISTS ticks_attempts_check;
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_grade_index_check;
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_rating_check;
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_lengths_check;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_grade_index_check;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_lengths_check;
ALTER TABLE walls DROP CONSTRAINT IF EXISTS walls_name_check;
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_name_check;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_lengths_check;
ALTER TABLE gyms DROP CONSTRAINT IF EXISTS gyms_amenities_check;
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_lengths_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_lengths_check;
