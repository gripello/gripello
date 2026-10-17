package tenancy

import (
	"context"
	"errors"
	"slices"
	"testing"

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
