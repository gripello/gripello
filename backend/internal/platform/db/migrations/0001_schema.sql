-- +goose Up

CREATE FUNCTION touch_updated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated = now(); RETURN NEW; END $$;

CREATE TABLE app_secrets (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE users (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL DEFAULT '',
  email_visibility boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  password_hash text NOT NULL DEFAULT '',
  token_key text NOT NULL,
  username text NOT NULL,
  firstname text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  avatar text NOT NULL DEFAULT '',
  banner text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT '' CHECK (language IN ('', 'en', 'de', 'nl', 'fr', 'es')),
  platform_admin boolean NOT NULL DEFAULT false,
  notification_prefs jsonb,
  followed_walls text[] NOT NULL DEFAULT '{}',
  leaderboard_hidden boolean NOT NULL DEFAULT false,
  follow_policy text NOT NULL DEFAULT '' CHECK (follow_policy IN ('', 'approve', 'open', 'closed')),
  reviews_anonymous boolean NOT NULL DEFAULT false,
  ticks_private boolean NOT NULL DEFAULT false,
  suspended_until timestamptz,
  suspension_reason text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX users_username_idx ON users (lower(username));
CREATE UNIQUE INDEX users_email_idx ON users (email) WHERE email <> '';
CREATE UNIQUE INDEX users_token_key_idx ON users (token_key);
CREATE INDEX users_followed_walls_idx ON users USING gin (followed_walls);

CREATE TABLE gyms (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  slug text NOT NULL,
  name text NOT NULL,
  unit_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT false,
  page_logo text NOT NULL DEFAULT '',
  page_icon text NOT NULL DEFAULT '',
  sign_image text NOT NULL DEFAULT '',
  cover_image text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  route_grade_system text NOT NULL DEFAULT '',
  boulder_grade_system text NOT NULL DEFAULT '',
  boulder_bands jsonb,
  legal_address text NOT NULL DEFAULT '',
  legal_phone text NOT NULL DEFAULT '',
  legal_register text NOT NULL DEFAULT '',
  legal_vat_id text NOT NULL DEFAULT '',
  legal_editorial text NOT NULL DEFAULT '',
  legal_representatives jsonb,
  imprint_url text NOT NULL DEFAULT '',
  privacy_url text NOT NULL DEFAULT '',
  privacy_extra text NOT NULL DEFAULT '',
  previous_slugs jsonb NOT NULL DEFAULT '[]',
  language text NOT NULL DEFAULT '' CHECK (language IN ('', 'en', 'de', 'nl', 'fr', 'es')),
  features jsonb NOT NULL DEFAULT '{}',
  premoderate_betas boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  latitude double precision NOT NULL DEFAULT 0,
  longitude double precision NOT NULL DEFAULT 0,
  website_url text NOT NULL DEFAULT '',
  opening_hours jsonb,
  hours_note text NOT NULL DEFAULT '',
  amenities text[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX gyms_slug_idx ON gyms (slug);
CREATE INDEX gyms_active_idx ON gyms (active);

CREATE TABLE retired_slugs (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  slug text NOT NULL UNIQUE,
  gym_name text NOT NULL DEFAULT '',
  retired_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  imprint_url text NOT NULL DEFAULT '',
  privacy_url text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  audit_retention_days integer NOT NULL DEFAULT 90,
  legal_address text NOT NULL DEFAULT '',
  legal_phone text NOT NULL DEFAULT '',
  legal_register text NOT NULL DEFAULT '',
  legal_vat_id text NOT NULL DEFAULT '',
  legal_editorial text NOT NULL DEFAULT '',
  legal_representatives jsonb,
  allow_registration boolean NOT NULL DEFAULT false,
  floor_plan text NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL UNIQUE,
  label text NOT NULL
);

INSERT INTO permissions (id, name, label) VALUES
  ('udhpcsmm70itmth', 'judge_competitions', 'Judge Competitions'),
  ('mwxnuwh3h5yir6r', 'manage_comments', 'Manage Comments'),
  ('o5lrz38ouhfzrzg', 'manage_competitions', 'Manage Competitions'),
  ('3y3uyx6cqpfrpew', 'manage_reports', 'Manage Reports'),
  ('oipckcq1p5p82jm', 'manage_routes', 'Manage Routes'),
  ('gyd38gnongq0dhv', 'manage_settings', 'Manage Settings'),
  ('revnhflnvise162', 'manage_tasks', 'Manage Tasks'),
  ('b2dozyti6idezpx', 'manage_users', 'Manage Users'),
  ('zpcwckk6p1csfw3', 'run_inventory', 'Run Inventory'),
  ('phcz982yhpgec74', 'view_analytics', 'View Analytics'),
  ('z0kvjbno4p2ctv7', 'view_audit_log', 'View Audit Log');

CREATE TABLE roles (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  permissions text[] NOT NULL DEFAULT '{}',
  color text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX roles_gym_name_idx ON roles (gym, name);
CREATE INDEX roles_permissions_idx ON roles USING gin (permissions);

CREATE TABLE memberships (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  role text NOT NULL REFERENCES roles ON DELETE RESTRICT
);
CREATE UNIQUE INDEX memberships_user_gym_idx ON memberships ("user", gym);
CREATE INDEX memberships_gym_idx ON memberships (gym);

CREATE TABLE invites (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  role text NOT NULL REFERENCES roles ON DELETE CASCADE,
  email text NOT NULL,
  firstname text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX invites_gym_email_idx ON invites (gym, email);

CREATE TABLE locations (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  name text NOT NULL,
  map_area jsonb,
  map jsonb,
  map_trace text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX locations_gym_name_idx ON locations (gym, lower(name));

CREATE TABLE walls (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  location text NOT NULL REFERENCES locations ON DELETE RESTRICT,
  name text NOT NULL,
  outline jsonb NOT NULL,
  edge jsonb NOT NULL,
  label jsonb,
  sort integer NOT NULL DEFAULT 0,
  anchor_from integer NOT NULL DEFAULT 0,
  anchor_to integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX walls_location_name_idx ON walls (location, lower(name));
CREATE INDEX walls_gym_idx ON walls (gym);

CREATE TABLE routes (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  name text NOT NULL,
  anchor_point integer NOT NULL DEFAULT 0,
  type text NOT NULL DEFAULT '' CHECK (type IN ('', 'Route', 'Boulder')),
  comment text NOT NULL DEFAULT '',
  creator jsonb NOT NULL DEFAULT '[]',
  archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  color text NOT NULL DEFAULT '',
  screw_date timestamptz,
  location text REFERENCES locations ON DELETE RESTRICT,
  wall text REFERENCES walls ON DELETE SET NULL,
  wall_position double precision NOT NULL DEFAULT 0,
  grade text NOT NULL,
  grade_system text NOT NULL DEFAULT '',
  grade_index double precision NOT NULL DEFAULT 0,
  permanent boolean NOT NULL DEFAULT false
);
CREATE INDEX routes_name_grade_anchor_idx ON routes (name, grade_index, anchor_point);
CREATE INDEX routes_archived_location_idx ON routes (archived, location);
CREATE INDEX routes_gym_idx ON routes (gym);
CREATE INDEX routes_wall_idx ON routes (wall);

CREATE TABLE ratings (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  route_id text NOT NULL REFERENCES routes ON DELETE CASCADE,
  "user" text REFERENCES users ON DELETE SET NULL,
  rating integer NOT NULL DEFAULT 0,
  comment text NOT NULL DEFAULT '',
  grade text NOT NULL DEFAULT '',
  grade_system text NOT NULL DEFAULT '',
  grade_index double precision NOT NULL DEFAULT 0
);
CREATE INDEX ratings_created_idx ON ratings (created);
CREATE INDEX ratings_route_rating_idx ON ratings (route_id, rating);
CREATE INDEX ratings_gym_idx ON ratings (gym);
CREATE INDEX ratings_user_idx ON ratings ("user");

CREATE TABLE beta_videos (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  route text NOT NULL REFERENCES routes ON DELETE CASCADE,
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  url text NOT NULL DEFAULT '',
  file text NOT NULL DEFAULT ''
);
CREATE INDEX beta_videos_route_created_idx ON beta_videos (route, created);
CREATE INDEX beta_videos_user_idx ON beta_videos ("user");

CREATE TABLE ticks (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  route text REFERENCES routes ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('flash', 'top', 'attempt')),
  attempts integer NOT NULL,
  date timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  grade text NOT NULL DEFAULT '',
  grade_system text NOT NULL DEFAULT '',
  grade_index double precision NOT NULL DEFAULT 0,
  route_name text NOT NULL DEFAULT ''
);
CREATE INDEX ticks_user_date_idx ON ticks ("user", date);
CREATE INDEX ticks_user_route_idx ON ticks ("user", route);
CREATE INDEX ticks_route_idx ON ticks (route);

CREATE TABLE seasons (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL
);
CREATE INDEX seasons_gym_starts_idx ON seasons (gym, starts_at);

CREATE TABLE tasks (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('defect', 'reset', 'maintenance', 'other', 'wish')),
  title text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '' CHECK (category IN ('', 'loose_bolt', 'loose_hold', 'spinning_hold', 'broken_hold', 'damaged_volume', 'sharp_edge', 'missing_hold', 'label_tag', 'other')),
  priority integer NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'done', 'dismissed', 'waiting')),
  route text REFERENCES routes ON DELETE CASCADE,
  wall text REFERENCES walls ON DELETE SET NULL,
  location text REFERENCES locations ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  photo text NOT NULL DEFAULT '',
  reporter text REFERENCES users ON DELETE SET NULL,
  assignee text REFERENCES users ON DELETE SET NULL,
  due_date timestamptz,
  resolution_note text NOT NULL DEFAULT '',
  done_at timestamptz,
  done_by text REFERENCES users ON DELETE SET NULL,
  route_type text NOT NULL DEFAULT '' CHECK (route_type IN ('', 'Route', 'Boulder')),
  grade text NOT NULL DEFAULT ''
);
CREATE INDEX tasks_status_idx ON tasks (status);
CREATE INDEX tasks_location_idx ON tasks (location);
CREATE INDEX tasks_route_idx ON tasks (route);
CREATE INDEX tasks_assignee_idx ON tasks (assignee);
CREATE INDEX tasks_created_idx ON tasks (created);
CREATE INDEX tasks_gym_idx ON tasks (gym);
CREATE INDEX tasks_reporter_idx ON tasks (reporter);

CREATE TABLE competitions (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text NOT NULL REFERENCES gyms ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text NOT NULL REFERENCES locations ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft', 'open', 'closed', 'published')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  scoring_format text NOT NULL CHECK (scoring_format IN ('dynamic', 'fixed', 'ifsc', 'tops', 'route_points', 'lead_height')),
  scoring jsonb,
  live_ranking boolean NOT NULL DEFAULT false,
  freeze_minutes integer NOT NULL DEFAULT 0,
  freeze_at timestamptz,
  discipline text NOT NULL CHECK (discipline IN ('boulder', 'rope')),
  registration_url text NOT NULL DEFAULT '',
  requires_payment boolean NOT NULL DEFAULT false
);
CREATE INDEX competitions_status_idx ON competitions (status);
CREATE INDEX competitions_starts_idx ON competitions (starts_at);
CREATE INDEX competitions_gym_idx ON competitions (gym);

CREATE TABLE competition_categories (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  competition text NOT NULL REFERENCES competitions ON DELETE CASCADE,
  name text NOT NULL,
  gender text NOT NULL DEFAULT '' CHECK (gender IN ('', 'female', 'male')),
  min_birth_year integer NOT NULL DEFAULT 0,
  max_birth_year integer NOT NULL DEFAULT 0,
  sort integer NOT NULL DEFAULT 0
);
CREATE INDEX competition_categories_competition_idx ON competition_categories (competition);

CREATE TABLE competition_routes (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  competition text NOT NULL REFERENCES competitions ON DELETE CASCADE,
  route text NOT NULL REFERENCES routes ON DELETE CASCADE,
  number integer NOT NULL,
  points double precision NOT NULL DEFAULT 0,
  zone boolean NOT NULL DEFAULT false,
  voided boolean NOT NULL DEFAULT false,
  hold_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX competition_routes_route_idx ON competition_routes (competition, route);
CREATE UNIQUE INDEX competition_routes_number_idx ON competition_routes (competition, number);

CREATE TABLE competition_entries (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  competition text NOT NULL REFERENCES competitions ON DELETE CASCADE,
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  category text NOT NULL REFERENCES competition_categories ON DELETE RESTRICT,
  bib integer NOT NULL DEFAULT 0,
  display_name text NOT NULL,
  birth_year integer NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  guardian_consent boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('registered', 'checked_in', 'disqualified', 'withdrawn')),
  paid boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX competition_entries_user_idx ON competition_entries (competition, "user");
CREATE UNIQUE INDEX competition_entries_bib_idx ON competition_entries (competition, bib) WHERE bib <> 0;

CREATE TABLE competition_scores (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  competition text NOT NULL REFERENCES competitions ON DELETE CASCADE,
  entry text NOT NULL REFERENCES competition_entries ON DELETE CASCADE,
  comp_route text NOT NULL REFERENCES competition_routes ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  zone_attempt integer NOT NULL DEFAULT 0,
  top_attempt integer NOT NULL DEFAULT 0,
  style text NOT NULL DEFAULT '' CHECK (style IN ('', 'lead', 'toprope')),
  height integer NOT NULL DEFAULT 0,
  height_plus boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX competition_scores_entry_route_idx ON competition_scores (entry, comp_route);
CREATE INDEX competition_scores_competition_idx ON competition_scores (competition);

CREATE TABLE follows (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  follower text NOT NULL REFERENCES users ON DELETE CASCADE,
  followee text NOT NULL REFERENCES users ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted'))
);
CREATE UNIQUE INDEX follows_pair_idx ON follows (follower, followee);
CREATE INDEX follows_followee_status_idx ON follows (followee, status);

CREATE TABLE blocks (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  blocker text NOT NULL REFERENCES users ON DELETE CASCADE,
  blocked text NOT NULL REFERENCES users ON DELETE CASCADE
);
CREATE UNIQUE INDEX blocks_pair_idx ON blocks (blocker, blocked);
CREATE INDEX blocks_blocked_idx ON blocks (blocked);

CREATE TABLE notifications (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  type text NOT NULL,
  params jsonb,
  url text NOT NULL DEFAULT '',
  read boolean NOT NULL DEFAULT false
);
CREATE INDEX notifications_user_read_idx ON notifications ("user", read);
CREATE INDEX notifications_user_created_idx ON notifications ("user", created);

CREATE TABLE push_subscriptions (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  device text NOT NULL DEFAULT ''
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions ("user");

CREATE TABLE user_badges (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  key text NOT NULL,
  tier integer NOT NULL,
  earned_on timestamptz
);
CREATE UNIQUE INDEX user_badges_user_key_tier_idx ON user_badges ("user", key, tier);

CREATE TABLE reports (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text REFERENCES gyms ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('rating', 'route', 'beta_video', 'profile')),
  content_id text NOT NULL,
  content_url text NOT NULL,
  content_snapshot text NOT NULL DEFAULT '',
  reason text NOT NULL CHECK (reason IN ('hate_speech', 'harassment', 'violence_threat', 'sexual_content', 'personal_data', 'ip_infringement', 'spam_fraud', 'other')),
  explanation text NOT NULL,
  notifier_name text NOT NULL,
  notifier_email text NOT NULL,
  good_faith boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('open', 'actioned', 'rejected')),
  decision text NOT NULL DEFAULT '' CHECK (decision IN ('', 'content_removed', 'content_kept')),
  decision_reason text NOT NULL DEFAULT '',
  decided_at timestamptz,
  decided_by text REFERENCES users ON DELETE SET NULL,
  receipt_sent boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  language text NOT NULL DEFAULT '' CHECK (language IN ('', 'en', 'de', 'nl', 'fr', 'es'))
);
CREATE INDEX reports_content_idx ON reports (content_id);
CREATE INDEX reports_status_idx ON reports (status);
CREATE INDEX reports_created_idx ON reports (created);
CREATE INDEX reports_gym_idx ON reports (gym);

CREATE TABLE moderation_items (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  gym text REFERENCES gyms ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('rating', 'beta_video', 'profile', 'competition_entry', 'task', 'route')),
  content_id text NOT NULL,
  author text REFERENCES users ON DELETE CASCADE,
  snapshot jsonb,
  files text[] NOT NULL DEFAULT '{}',
  state text NOT NULL CHECK (state IN ('unreviewed', 'approved', 'pending', 'hidden')),
  hidden_by text NOT NULL DEFAULT '' CHECK (hidden_by IN ('', 'gym', 'platform')),
  reports_count integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  reviewed_by text REFERENCES users ON DELETE SET NULL,
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX moderation_items_content_idx ON moderation_items (content_type, content_id);
CREATE INDEX moderation_items_gym_state_idx ON moderation_items (gym, state, reports_count);

CREATE TABLE audit_logs (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  actor text REFERENCES users ON DELETE SET NULL,
  actor_label text NOT NULL DEFAULT '',
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'login', 'login_failed', 'password_reset_request', 'password_reset', 'email_change_request', 'email_change')),
  collection_name text NOT NULL DEFAULT '',
  record_id text NOT NULL DEFAULT '',
  changed_fields jsonb,
  ip text NOT NULL DEFAULT '',
  gym text REFERENCES gyms ON DELETE SET NULL
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);
CREATE INDEX audit_logs_collection_idx ON audit_logs (collection_name);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs (actor, created);
CREATE INDEX audit_logs_gym_idx ON audit_logs (gym);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  method text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  last_seen timestamptz
);
CREATE INDEX sessions_user_idx ON sessions ("user");
CREATE INDEX sessions_last_seen_idx ON sessions (last_seen);

CREATE TABLE mfa_factors (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('totp', 'passkey')),
  name text NOT NULL DEFAULT '',
  last_used timestamptz,
  secret text NOT NULL DEFAULT '',
  algorithm text NOT NULL DEFAULT '',
  digits integer NOT NULL DEFAULT 0,
  period integer NOT NULL DEFAULT 0,
  last_step bigint NOT NULL DEFAULT 0,
  credential_id text NOT NULL DEFAULT '',
  public_key text NOT NULL DEFAULT '',
  sign_count bigint NOT NULL DEFAULT 0,
  aaguid text NOT NULL DEFAULT '',
  transports jsonb,
  backup_eligible boolean NOT NULL DEFAULT false,
  backup_state boolean NOT NULL DEFAULT false,
  attestation_type text NOT NULL DEFAULT '',
  user_handle text NOT NULL DEFAULT ''
);
CREATE INDEX mfa_factors_user_idx ON mfa_factors ("user");
CREATE UNIQUE INDEX mfa_factors_totp_idx ON mfa_factors ("user") WHERE kind = 'totp';
CREATE UNIQUE INDEX mfa_factors_credential_idx ON mfa_factors (credential_id) WHERE credential_id <> '';

CREATE TABLE mfa_recovery_codes (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  "user" text NOT NULL UNIQUE REFERENCES users ON DELETE CASCADE,
  codes jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE login_lockouts (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  key text NOT NULL UNIQUE,
  failures integer NOT NULL DEFAULT 0,
  window_start timestamptz,
  locked_until timestamptz
);

CREATE TABLE cap_nonces (
  id text PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  jti text NOT NULL UNIQUE
);
CREATE INDEX cap_nonces_created_idx ON cap_nonces (created);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  audience jsonb NOT NULL DEFAULT '{"public":true}',
  created timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_created_idx ON events (created);

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  key text NOT NULL,
  payload jsonb,
  run_after timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_kind_key_idx ON jobs (kind, key);
CREATE INDEX jobs_run_after_idx ON jobs (run_after);

-- +goose StatementBegin
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = current_schema() AND column_name = 'updated' AND data_type = 'timestamp with time zone'
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated()', t, t);
  END LOOP;
END $$;
-- +goose StatementEnd

CREATE VIEW average_rating AS
SELECT routes.*,
  (SELECT AVG(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::double precision AS average_rating,
  (SELECT COUNT(NULLIF(r.rating, 0)) FROM ratings r WHERE r.route_id = routes.id)::integer AS ratings_count
FROM routes;

CREATE VIEW open_route_defects AS
SELECT id, gym, route, category, created FROM tasks
WHERE kind = 'defect' AND status IN ('open', 'in_progress', 'waiting') AND route IS NOT NULL;

CREATE VIEW friend_ticks AS
SELECT ticks.id, follows.follower AS viewer, ticks."user", ticks.route, ticks.route_name, ticks.type, ticks.attempts,
  ticks.date, ticks.grade, ticks.grade_system, ticks.grade_index, ticks.created
FROM follows
JOIN ticks ON ticks."user" = follows.followee
JOIN users ON users.id = ticks."user"
WHERE follows.status = 'accepted' AND users.ticks_private = false;

CREATE VIEW tick_sends AS
SELECT MIN(id) AS id, "user", route FROM ticks WHERE type <> 'attempt' AND route IS NOT NULL GROUP BY "user", route;

CREATE VIEW competition_standings AS
SELECT id, competition, category, bib, (CASE WHEN hidden THEN '' ELSE display_name END) AS display_name
FROM competition_entries WHERE status IN ('registered', 'checked_in');

CREATE VIEW task_assignees AS
SELECT memberships.id, memberships."user", memberships.gym,
  COALESCE(NULLIF(TRIM(COALESCE(users.firstname, '') || ' ' || COALESCE(users.name, '')), ''), users.username) AS name
FROM memberships
JOIN users ON users.id = memberships."user"
JOIN roles ON roles.id = memberships.role
WHERE 'manage_tasks' = ANY (roles.permissions);

CREATE VIEW gym_stats AS
SELECT gyms.id,
  (SELECT COUNT(*) FROM memberships WHERE memberships.gym = gyms.id)::integer AS members,
  (SELECT COUNT(*) FROM routes WHERE routes.gym = gyms.id AND routes.archived = false)::integer AS routes
FROM gyms;

CREATE VIEW ratings_stats AS
SELECT gym AS id, gym, COUNT(id) AS total_reviews, ROUND(AVG(NULLIF(rating, 0))::numeric, 1) AS avg_rating,
  COUNT(*) FILTER (WHERE NULLIF(rating, 0) IS NOT NULL AND NULLIF(rating, 0) <= 2) AS low_rated,
  COUNT(*) FILTER (WHERE created >= now() - interval '7 days') AS this_week
FROM ratings GROUP BY gym;

CREATE VIEW used_colors AS
SELECT DISTINCT ON (gym, color) id, gym, color FROM routes ORDER BY gym, color, id;

-- +goose Down
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
