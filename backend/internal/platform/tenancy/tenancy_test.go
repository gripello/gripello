package tenancy

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/testkit"
)

func TestAudienceSetsMatchTheSingleQuestions(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	seed := []string{
		`INSERT INTO users (id, token_key, username) VALUES ('setter', 'k1', 'setter'), ('climber', 'k2', 'climber'), ('friend', 'k3', 'friend'), ('asking', 'k4', 'asking')`,
		`INSERT INTO gyms (id, slug, name) VALUES ('g1', 'g1', 'G1'), ('g2', 'g2', 'G2')`,
		`INSERT INTO roles (id, gym, name, permissions) VALUES ('r1', 'g1', 'setters', '{manage_routes,manage_tasks}'), ('r2', 'g2', 'setters', '{manage_tasks}'), ('r3', 'g1', 'helpers', '{}')`,
		`INSERT INTO memberships (id, "user", gym, role) VALUES ('m1', 'setter', 'g1', 'r1'), ('m2', 'climber', 'g2', 'r2'), ('m3', 'friend', 'g1', 'r3')`,
		`INSERT INTO follows (id, follower, followee, status) VALUES ('f1', 'friend', 'climber', 'accepted'), ('f2', 'asking', 'climber', 'pending')`,
	}
	for _, statement := range seed {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	perms := New(pool)

	holders, err := perms.UsersWith(ctx, "g1", "manage_tasks")
	if err != nil || !slices.Equal(holders, []string{"setter"}) {
		t.Fatalf("UsersWith = %v, %v; want only setter (permission in g1)", holders, err)
	}
	for _, user := range []string{"setter", "climber", "friend"} {
		if perms.Can(ctx, user, "g1", "manage_tasks") != slices.Contains(holders, user) {
			t.Errorf("Can and UsersWith disagree for %s", user)
		}
	}

	followers, err := perms.Followers(ctx, "climber")
	if err != nil || !slices.Equal(followers, []string{"friend"}) {
		t.Fatalf("Followers = %v, %v; want only the accepted follower", followers, err)
	}
	for _, user := range []string{"friend", "asking", "setter"} {
		if perms.Follows(ctx, user, "climber") != slices.Contains(followers, user) {
			t.Errorf("Follows and Followers disagree for %s", user)
		}
	}
}

func TestGymVisibility(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	seed := []string{
		`INSERT INTO users (id, token_key, username, platform_admin) VALUES ('member', 'k1', 'member', false), ('manager', 'k2', 'manager', false),
			('stranger', 'k3', 'stranger', false), ('operator', 'k4', 'operator', true)`,
		`INSERT INTO gyms (id, slug, name, active, hidden) VALUES ('open', 'open', 'Open', true, false), ('closed', 'closed', 'Closed', false, false),
			('hidden', 'hidden', 'Hidden', true, true)`,
		`INSERT INTO roles (id, gym, name, permissions) VALUES ('ro', 'open', 'helpers', '{}'), ('rc', 'closed', 'helpers', '{}'), ('rcm', 'closed', 'admins', '{manage_settings}'),
			('rh', 'hidden', 'helpers', '{}'), ('rhm', 'hidden', 'admins', '{manage_settings}')`,
		`INSERT INTO memberships (id, "user", gym, role) VALUES ('m1', 'member', 'closed', 'rc'), ('m2', 'member', 'hidden', 'rh'),
			('m3', 'manager', 'closed', 'rcm'), ('m4', 'manager', 'hidden', 'rhm')`,
	}
	for _, statement := range seed {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	visible := map[string][]string{
		"open":    {"", "member", "manager", "stranger", "operator"},
		"closed":  {"member", "manager", "operator"},
		"hidden":  {"member", "manager", "operator"},
		"unknown": {"", "member", "manager", "stranger", "operator"},
	}
	perms := New(pool)
	for gym, viewers := range visible {
		for _, viewer := range []string{"", "member", "manager", "stranger", "operator"} {
			var got bool
			if err := pool.QueryRow(ctx, `SELECT gym_visible($1, $2)`, gym, viewer).Scan(&got); err != nil {
				t.Fatal(err)
			}
			if got != slices.Contains(viewers, viewer) {
				t.Errorf("gym_visible(%s, %q) = %v", gym, viewer, got)
			}
			if gym == "unknown" {
				continue
			}
			viewerCtx := auth.WithPrincipal(ctx, auth.Principal{UserID: viewer})
			if viewer == "" {
				viewerCtx = ctx
			}
			id, err := ResolveGym(viewerCtx, pool, gym)
			if got != (err == nil && id == gym) || !got && !errors.Is(err, httpx.ErrNotFound) {
				t.Errorf("ResolveGym(%s) as %q = %q, %v", gym, viewer, id, err)
			}
			if err := RequireGym(viewerCtx, pool, gym); got != (err == nil) {
				t.Errorf("RequireGym(%s) as %q = %v", gym, viewer, err)
			}
		}
		if gym == "unknown" {
			continue
		}
		members, err := perms.GymViewers(ctx, gym)
		if err != nil {
			t.Fatal(err)
		}
		slices.Sort(members)
		want := []string{"*"}
		if !slices.Contains(viewers, "") {
			want = slices.DeleteFunc(slices.Clone(viewers), func(v string) bool { return v == "operator" })
			slices.Sort(want)
		}
		if !slices.Equal(members, want) {
			t.Errorf("GymViewers(%s) = %v, want %v", gym, members, want)
		}
	}
}

func TestResolveGymPrefersAnIDOverAnEqualSlug(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO gyms (id, slug, name, active) VALUES ('victim', 'victim-hall', 'Victim', true), ('squatter', 'victim', 'Squatter', true)`); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"victim": "victim", "victim-hall": "victim", "squatter": "squatter"} {
		if got, err := ResolveGym(ctx, pool, key); err != nil || got != want {
			t.Errorf("ResolveGym(%s) = %q, %v; want %q", key, got, err, want)
		}
	}
}

func TestReferencesStayInsideTheirGymOrCompetition(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	for _, sql := range []string{
		`INSERT INTO users (id, token_key, username) VALUES ('u1', 'k1', 'u1')`,
		`INSERT INTO gyms (id, slug, name) VALUES ('g1', 'g1', 'G1'), ('g2', 'g2', 'G2')`,
		`INSERT INTO roles (id, gym, name) VALUES ('r1', 'g1', 'setters')`,
		`INSERT INTO locations (id, gym, name) VALUES ('l1', 'g1', 'Hall'), ('l2', 'g2', 'Hall')`,
		`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ('w1', 'g1', 'l1', 'Slab', '[[1,1],[2,1],[2,2]]', '[]')`,
		`INSERT INTO routes (id, gym, name, grade, location, wall) VALUES ('rt1', 'g1', 'Crimp', '6a', 'l1', 'w1')`,
		`INSERT INTO tasks (id, gym, title, route, wall, location, kind, priority, status) VALUES ('t1', 'g1', 'Fix', 'rt1', 'w1', 'l1', 'defect', 2, 'open')`,
		`INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline)
			VALUES ('c1', 'g1', 'Jam', 'l1', 'open', now(), now() + interval '1 day', 'tops', 'boulder'),
			       ('c2', 'g1', 'Cup', 'l1', 'open', now(), now() + interval '1 day', 'tops', 'boulder')`,
		`INSERT INTO competition_categories (id, competition, name) VALUES ('cat1', 'c1', 'Open')`,
		`INSERT INTO competition_entries (id, competition, category, "user", display_name, birth_year, status, bib) VALUES ('e1', 'c1', 'cat1', 'u1', 'U', 1990, 'registered', 1)`,
		`INSERT INTO competition_routes (id, competition, route, number) VALUES ('cr2', 'c2', 'rt1', 1)`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	for name, sql := range map[string]string{
		"membership with another gym's role":      `INSERT INTO memberships (id, "user", gym, role) VALUES ('m1', 'u1', 'g2', 'r1')`,
		"invite with another gym's role":          `INSERT INTO invites (id, gym, role, email, token_hash, expires_at) VALUES ('i1', 'g2', 'r1', 'a@b.c', 'h', now())`,
		"review of another gym's route":           `INSERT INTO ratings (id, gym, route_id, rating) VALUES ('ra1', 'g2', 'rt1', 3)`,
		"beta of another gym's route":             `INSERT INTO beta_videos (id, gym, route, "user", url) VALUES ('b1', 'g2', 'rt1', 'u1', 'x')`,
		"route in another gym's hall":             `INSERT INTO routes (id, gym, name, grade, location) VALUES ('rt2', 'g2', 'X', '6a', 'l1')`,
		"wall in another gym's hall":              `INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ('w2', 'g2', 'l1', 'X', '[[1,1],[2,1],[2,2]]', '[]')`,
		"competition in another gym's hall":       `INSERT INTO competitions (id, gym, name, location, status, starts_at, ends_at, scoring_format, discipline) VALUES ('c3', 'g2', 'X', 'l1', 'open', now(), now(), 'tops', 'boulder')`,
		"task on another gym's route":             `INSERT INTO tasks (id, gym, title, route, kind, priority, status) VALUES ('t2', 'g2', 'X', 'rt1', 'defect', 2, 'open')`,
		"entry in another competition's category": `INSERT INTO competition_entries (id, competition, category, "user", display_name, birth_year, status, bib) VALUES ('e2', 'c2', 'cat1', 'u1', 'U', 1990, 'registered', 2)`,
		"score for another competition's entry":   `INSERT INTO competition_scores (id, competition, entry, comp_route) VALUES ('s1', 'c2', 'e1', 'cr2')`,
	} {
		var pgErr *pgconn.PgError
		if _, err := pool.Exec(ctx, sql); !errors.As(err, &pgErr) || pgErr.Code != "23503" {
			t.Errorf("%s: %v, want a foreign key violation", name, err)
		}
	}
	if _, err := pool.Exec(ctx, `DELETE FROM walls WHERE id = 'w1'`); err != nil {
		t.Fatal(err)
	}
	var routeWall, taskWall *string
	var routeGym string
	pool.QueryRow(ctx, `SELECT r.wall, r.gym, t.wall FROM routes r, tasks t WHERE r.id = 'rt1' AND t.id = 't1'`).Scan(&routeWall, &routeGym, &taskWall)
	if routeWall != nil || taskWall != nil || routeGym != "g1" {
		t.Errorf("deleting a wall must clear only the wall: route wall %v gym %q, task wall %v", routeWall, routeGym, taskWall)
	}
}
