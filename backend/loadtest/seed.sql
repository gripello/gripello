-- Synthetic load test data: 3 gyms, 400 active + 1600 archived routes each, 5000 climbers, ~250k ticks, ~60k ratings.
-- Needs a verified loadtest@example.com (gripello admin create-user + set-user -verified); every climber shares its password.
-- docker compose exec -T postgres psql -U gripello gripello < backend/loadtest/seed.sql
BEGIN;
CREATE TEMP TABLE n AS SELECT generate_series(1, 5000) AS i;
CREATE FUNCTION pg_temp.id() RETURNS text LANGUAGE sql AS $$ SELECT substr(md5(random()::text || clock_timestamp()::text), 1, 15) $$;

INSERT INTO gyms (id, slug, name, active, features, boulder_grade_system, route_grade_system)
SELECT pg_temp.id(), 'load-' || i, 'Load Gym ' || i, true, '{"beta_videos": true}', 'font', 'french'
FROM generate_series(1, 3) i;

INSERT INTO locations (id, gym, name)
SELECT pg_temp.id(), g.id, 'Hall ' || i FROM gyms g, generate_series(1, 3) i WHERE g.slug LIKE 'load-%';

INSERT INTO walls (id, gym, location, name, outline, edge, sort)
SELECT pg_temp.id(), l.gym, l.id, l.name || ' Wall ' || i, '[]', '[]', i FROM locations l, generate_series(1, 8) i
WHERE l.gym IN (SELECT id FROM gyms WHERE slug LIKE 'load-%');

INSERT INTO routes (id, gym, name, type, location, wall, grade, grade_system, grade_index, color, screw_date, archived, archived_at, created)
SELECT pg_temp.id(), w.gym, 'Route ' || w.sort || '-' || i, CASE WHEN i % 3 = 0 THEN 'Route' ELSE 'Boulder' END,
       w.location, w.id, (4 + i % 5) || (ARRAY['a', 'b', 'c'])[1 + i % 3], CASE WHEN i % 3 = 0 THEN 'french' ELSE 'font' END,
       4 + i % 5 + (i % 3) / 3.0, (ARRAY['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#212121'])[1 + i % 6],
       now() - (i * interval '2 days'), i > 17, CASE WHEN i > 17 THEN now() - ((i - 17) * interval '2 days') END,
       now() - (i * interval '2 days')
FROM walls w, generate_series(1, 83) i
WHERE w.gym IN (SELECT id FROM gyms WHERE slug LIKE 'load-%');

INSERT INTO users (id, email, verified, password_hash, token_key, username, firstname, name, follow_policy)
SELECT pg_temp.id(), 'loadtest+' || i || '@example.com', true,
       (SELECT password_hash FROM users WHERE email = 'loadtest@example.com'),
       md5(random()::text), 'load' || i, 'Load', 'Climber ' || i, 'open'
FROM n;

CREATE TEMP TABLE climbers AS SELECT id, row_number() OVER () AS i FROM users WHERE email LIKE 'loadtest+%';
CREATE TEMP TABLE pool AS SELECT id, gym, name, grade, grade_system, grade_index, created, row_number() OVER () AS i FROM routes
WHERE gym IN (SELECT id FROM gyms WHERE slug LIKE 'load-%');

INSERT INTO ticks (id, "user", route, type, attempts, date, grade, grade_system, grade_index, route_name)
SELECT pg_temp.id(), c.id, p.id, (ARRAY['flash', 'top', 'top', 'attempt'])[1 + (s % 4)], 1 + s % 5,
       greatest(p.created, now() - (s % 120) * interval '1 day'), p.grade, p.grade_system, p.grade_index, p.name
FROM climbers c CROSS JOIN generate_series(1, 50) s
JOIN pool p ON p.i = 1 + (hashint4(c.i::int * 64 + s) & 2147483647) % (SELECT count(*) FROM pool);

INSERT INTO ratings (id, gym, route_id, "user", rating, grade_index)
SELECT pg_temp.id(), p.gym, p.id, c.id, 1 + (c.i + s) % 5, p.grade_index
FROM climbers c CROSS JOIN generate_series(1, 12) s
JOIN pool p ON p.i = 1 + (hashint4(c.i::int * 16 + s + 1000000) & 2147483647) % (SELECT count(*) FROM pool);

INSERT INTO follows (id, follower, followee, status)
SELECT pg_temp.id(), a.id, b.id, 'accepted'
FROM climbers a JOIN climbers b ON b.i IN (1 + (a.i * 7) % 5000, 1 + (a.i * 13) % 5000, 1 + (a.i * 31) % 5000)
WHERE a.id <> b.id
ON CONFLICT DO NOTHING;
COMMIT;
ANALYZE;
