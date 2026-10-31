-- Load test data, everything named "loadtest": gyms loadtest-1..N (3 halls x 8 walls, ~170 active + ~500 archived routes
-- each, a running season, a live boulder competition, open tasks), climbers loadtest+1..M@example.com with ticks,
-- reviews and follows, and per gym two setters loadtest+staff-<gym>-<n>@example.com (routes, tasks, settings, judging).
-- Ids derive from names, so re-running only adds what is missing and moves the season/competition window to now.
-- yarn loadtest:seed [-v gyms=3 -v climbers=3000 -v password_hash='<sha256$bcrypt>']; the default password is loadtest-password.
-- Remove: gripello admin truncate-prefix --prefix loadtest, then DELETE FROM gyms WHERE slug LIKE 'loadtest-%'.
\set ON_ERROR_STOP on
\if :{?gyms}
\else
\set gyms 3
\endif
\if :{?climbers}
\else
\set climbers 3000
\endif
\if :{?password_hash}
\else
\set password_hash 'sha256$$2a$10$5AgYcaVVt.H3nsdKinYXrOYwbw1ybLRgYy1W7MnTEjq9ysKigjyS2'
\endif

BEGIN;
CREATE FUNCTION pg_temp.lid(key text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT substr(md5('loadtest:' || key), 1, 15) $$;
CREATE TEMP TABLE boulder_grades (n int, grade text, idx double precision) ON COMMIT DROP;
INSERT INTO boulder_grades VALUES (0, '4', 12.1), (1, '5', 14.2), (2, '5+', 15), (3, '6A', 15.7), (4, '6A+', 16.4),
  (5, '6B', 17.1), (6, '6B+', 17.9), (7, '6C', 18.7), (8, '7A', 20.3), (9, '7B', 22.4);
CREATE TEMP TABLE route_grades (n int, grade text, idx double precision) ON COMMIT DROP;
INSERT INTO route_grades VALUES (0, '5', 9), (1, '5+', 10), (2, '6a', 11), (3, '6a+', 12), (4, '6b', 13),
  (5, '6b+', 14), (6, '6c', 15), (7, '7a', 17), (8, '7b', 19), (9, '7c', 21);

INSERT INTO gyms (id, slug, name, active, features, boulder_grade_system, route_grade_system, description, address,
  latitude, longitude, website_url, opening_hours, amenities, contact_email)
SELECT pg_temp.lid('gym' || g), 'loadtest-' || g, 'Loadtest Gym ' || g, true, '{"beta_links": true, "beta_uploads": true}', 'font', 'french',
  'Synthetic gym for load tests.', 'Teststrasse ' || g || ', 10115 Berlin', 52.52 + g / 100.0, 13.40 + g / 100.0,
  'https://example.com', '{"mon": [["07:00", "23:00"]], "tue": [["07:00", "23:00"]], "wed": [["07:00", "23:00"]],
  "thu": [["07:00", "23:00"]], "fri": [["07:00", "23:00"]], "sat": [["09:00", "22:00"]], "sun": [["09:00", "22:00"]]}',
  '{toilets,showers,cafe,rental}', 'loadtest@example.com'
FROM generate_series(1, :gyms) g
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE lg ON COMMIT DROP AS SELECT g, pg_temp.lid('gym' || g) AS id FROM generate_series(1, :gyms) g;

INSERT INTO roles (id, gym, name, description, permissions)
SELECT pg_temp.lid('role' || g), id, 'loadtest staff', 'Load test setters and judges',
  '{manage_routes,manage_tasks,manage_settings,manage_competitions,judge_competitions,view_analytics,run_inventory}'
FROM lg ON CONFLICT DO NOTHING;

INSERT INTO locations (id, gym, name)
SELECT pg_temp.lid('loc' || g || '-' || l), id, 'loadtest hall ' || l FROM lg, generate_series(1, 3) l
ON CONFLICT DO NOTHING;

INSERT INTO walls (id, gym, location, name, outline, edge, sort)
SELECT pg_temp.lid('wall' || g || '-' || l || '-' || w), id, pg_temp.lid('loc' || g || '-' || l), 'loadtest wall ' || l || '.' || w,
  '[]', '[]', w
FROM lg, generate_series(1, 3) l, generate_series(1, 8) w
ON CONFLICT DO NOTHING;

-- 30 routes per wall, the newest 7 active; every third is a rope route.
INSERT INTO routes (id, gym, name, type, location, wall, grade, grade_system, grade_index, color, creator, screw_date,
  archived, archived_at, created)
SELECT pg_temp.lid('route' || g || '-' || l || '-' || w || '-' || i), lg.id, 'loadtest ' || l || '.' || w || '-' || i,
  CASE WHEN i % 3 = 0 THEN 'Route' ELSE 'Boulder' END, pg_temp.lid('loc' || g || '-' || l),
  pg_temp.lid('wall' || g || '-' || l || '-' || w),
  CASE WHEN i % 3 = 0 THEN rg.grade ELSE bg.grade END, CASE WHEN i % 3 = 0 THEN 'french' ELSE 'font' END,
  CASE WHEN i % 3 = 0 THEN rg.idx ELSE bg.idx END,
  (ARRAY['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#212121'])[1 + (i + w) % 6], '["loadtest setter"]',
  now() - (i * interval '5 days'), i > 7, CASE WHEN i > 7 THEN now() - ((i - 7) * interval '5 days') END,
  now() - (i * interval '5 days')
FROM lg, generate_series(1, 3) l, generate_series(1, 8) w, generate_series(1, 30) i
JOIN boulder_grades bg ON bg.n = i % 10
JOIN route_grades rg ON rg.n = (i * 7) % 10
ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, verified, password_hash, token_key, username, firstname, name, follow_policy)
SELECT pg_temp.lid('user' || i), 'loadtest+' || i || '@example.com', true, :'password_hash', pg_temp.lid('key' || i),
  'loadtest' || i, 'Load', 'Climber ' || i, (ARRAY['open', 'approve'])[1 + i % 2]
FROM generate_series(1, :climbers) i
ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, verified, password_hash, token_key, username, firstname, name)
SELECT pg_temp.lid('staff' || g || '-' || s), 'loadtest+staff-' || g || '-' || s || '@example.com', true, :'password_hash',
  pg_temp.lid('staffkey' || g || '-' || s), 'loadtest_staff_' || g || '_' || s, 'Load', 'Setter ' || g || '.' || s
FROM lg, generate_series(1, 2) s
ON CONFLICT DO NOTHING;

INSERT INTO memberships (id, "user", gym, role)
SELECT pg_temp.lid('member' || g || '-' || s), pg_temp.lid('staff' || g || '-' || s), id, pg_temp.lid('role' || g)
FROM lg, generate_series(1, 2) s
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE pool ON COMMIT DROP AS
SELECT r.id, r.gym, r.name, r.grade, r.grade_system, r.grade_index, r.created, lg.g,
  row_number() OVER (PARTITION BY r.gym ORDER BY r.id) AS i, count(*) OVER (PARTITION BY r.gym) AS n
FROM routes r JOIN lg ON lg.id = r.gym;

-- Climber c belongs to gym 1 + c % gyms (the tool uses the same rule).
INSERT INTO ticks (id, "user", route, type, attempts, date, grade, grade_system, grade_index, route_name)
SELECT pg_temp.lid('tick' || c || '-' || s), pg_temp.lid('user' || c), p.id, (ARRAY['flash', 'top', 'top', 'attempt'])[1 + s % 4],
  1 + s % 5, greatest(p.created, now() - (s * 3 % 120) * interval '1 day'), p.grade, p.grade_system, p.grade_index, p.name
FROM generate_series(1, :climbers) c CROSS JOIN generate_series(1, 40) s
JOIN pool p ON p.g = 1 + c % :gyms AND p.i = 1 + (hashint4(c * 64 + s) & 2147483647) % p.n
ON CONFLICT DO NOTHING;

INSERT INTO ratings (id, gym, route_id, "user", rating, grade, grade_system, grade_index, comment, created)
SELECT pg_temp.lid('rating' || c || '-' || s), p.gym, p.id, pg_temp.lid('user' || c), 1 + (c + s) % 5, p.grade, p.grade_system,
  p.grade_index, CASE WHEN s % 3 = 0 THEN 'loadtest review: nice moves' ELSE '' END, now() - (s * 7 % 90) * interval '1 day'
FROM generate_series(1, :climbers) c CROSS JOIN generate_series(1, 8) s
JOIN pool p ON p.g = 1 + c % :gyms AND p.i = 1 + (hashint4(c * 16 + s + 1000000) & 2147483647) % p.n
ON CONFLICT DO NOTHING;

INSERT INTO follows (id, follower, followee, status)
SELECT pg_temp.lid('follow' || a || '-' || b), pg_temp.lid('user' || a), pg_temp.lid('user' || b), 'accepted'
FROM generate_series(1, :climbers) a
CROSS JOIN LATERAL (VALUES (1 + (a * 7) % :climbers), (1 + (a * 13) % :climbers), (1 + (a * 31) % :climbers),
  (1 + (a + 1) % :climbers)) f(b)
WHERE a <> b
ON CONFLICT DO NOTHING;

INSERT INTO seasons (id, gym, name, starts_at, ends_at)
SELECT pg_temp.lid('season' || g), id, 'loadtest season', now() - interval '30 days', now() + interval '90 days' FROM lg
ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, live_ranking, discipline)
SELECT pg_temp.lid('comp' || g), id, 'loadtest cup ' || g, pg_temp.lid('loc' || g || '-1'), 'open', now() - interval '1 hour',
  now() + interval '30 days', 'tops', true, 'boulder'
FROM lg
ON CONFLICT (id) DO UPDATE SET status = 'open', starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

INSERT INTO competition_categories (id, competition, name, sort)
SELECT pg_temp.lid('cat' || g || '-' || k), pg_temp.lid('comp' || g), 'loadtest ' || name, k
FROM lg, (VALUES (1, 'Open'), (2, 'Youth')) c(k, name)
ON CONFLICT DO NOTHING;

INSERT INTO competition_routes (id, competition, route, number, zone)
SELECT pg_temp.lid('comproute' || g || '-' || n), pg_temp.lid('comp' || g), r.id, n, true
FROM lg CROSS JOIN LATERAL (
  SELECT id, row_number() OVER (ORDER BY name) AS n FROM routes
  WHERE location = pg_temp.lid('loc' || lg.g || '-1') AND type = 'Boulder' AND NOT archived LIMIT 20) r
ON CONFLICT DO NOTHING;

-- The first 300 climbers of each gym compete; even bibs score themselves, judges score the odd ones.
INSERT INTO competition_entries (id, competition, "user", category, bib, display_name, birth_year, status)
SELECT pg_temp.lid('entry' || c), pg_temp.lid('comp' || (1 + c % :gyms)), pg_temp.lid('user' || c),
  pg_temp.lid('cat' || (1 + c % :gyms) || '-' || (1 + c % 2)), c, 'Load Climber ' || c, 1980 + c % 25, 'checked_in'
FROM generate_series(1, least(:climbers, 300 * :gyms)) c
ON CONFLICT DO NOTHING;

INSERT INTO competition_scores (id, competition, entry, comp_route, attempts, zone_attempt, top_attempt, scored_by)
SELECT pg_temp.lid('score' || c || '-' || n), pg_temp.lid('comp' || (1 + c % :gyms)), pg_temp.lid('entry' || c),
  pg_temp.lid('comproute' || (1 + c % :gyms) || '-' || n), 1 + (c + n) % 4, 1, CASE WHEN (c + n) % 3 = 0 THEN 0 ELSE 1 + (c + n) % 4 END,
  pg_temp.lid('user' || c)
FROM generate_series(1, least(:climbers, 300 * :gyms)) c, generate_series(1, 8) n
WHERE c % 2 = 0 AND EXISTS (SELECT 1 FROM competition_routes WHERE id = pg_temp.lid('comproute' || (1 + c % :gyms) || '-' || n))
ON CONFLICT DO NOTHING;

INSERT INTO tasks (id, gym, kind, title, category, priority, status, route, wall, location, description, reporter)
SELECT pg_temp.lid('task' || lg.g || '-' || t), p.gym, CASE WHEN t % 3 = 0 THEN 'maintenance' ELSE 'defect' END,
  'loadtest task ' || t, CASE WHEN t % 3 = 0 THEN '' ELSE (ARRAY['loose_hold', 'spinning_hold', 'label_tag'])[1 + t % 3] END,
  1 + t % 4, (ARRAY['open', 'open', 'in_progress', 'waiting'])[1 + t % 4], p.id, r.wall, r.location, 'loadtest seed',
  pg_temp.lid('user' || t)
FROM lg CROSS JOIN generate_series(1, 25) t
JOIN pool p ON p.g = lg.g AND p.i = 1 + t * 11 % p.n
JOIN routes r ON r.id = p.id AND NOT r.archived
ON CONFLICT DO NOTHING;
COMMIT;
ANALYZE;
