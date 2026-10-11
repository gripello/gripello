package main

import (
	"context"
	"testing"

	"gripello/internal/platform/db"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testkit"
)

func TestAdminSeedsGymUserAndMembershipIdempotently(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	gym, err := adminCreateGym(ctx, pool, []string{"--slug", "e2e", "--name", "E2E Gym", "--features", `{"beta_videos":true}`})
	if err != nil {
		t.Fatal(err)
	}
	if again, err := adminCreateGym(ctx, pool, []string{"--slug", "e2e", "--name", "E2E Gym"}); err != nil || again != gym {
		t.Fatalf("second create-gym = %q, %v", again, err)
	}
	user, err := adminCreateUser(ctx, pool, []string{"--email", "a@gripello.test", "--password", "E2ePassw0rd!", "--username", "e2ea", "--verified"})
	if err != nil {
		t.Fatal(err)
	}
	if again, err := adminCreateUser(ctx, pool, []string{"--email", "a@gripello.test", "--password", "Other-pw-123", "--username", "e2ea", "--verified", "--platform-admin"}); err != nil || again != user {
		t.Fatalf("second create-user = %q, %v", again, err)
	}
	if _, err := adminAddMembership(ctx, pool, []string{"--user", "a@gripello.test", "--gym", "e2e", "--role", "routesetter"}); err != nil {
		t.Fatal(err)
	}
	if _, err := adminAddMembership(ctx, pool, []string{"--user", user, "--gym", gym, "--role", "admin"}); err != nil {
		t.Fatal(err)
	}
	var role string
	var active, betas, platformAdmin bool
	pool.QueryRow(ctx, `SELECT r.name, g.active, (g.features->>'beta_videos')::bool, u.platform_admin
		FROM memberships m JOIN roles r ON r.id = m.role JOIN gyms g ON g.id = m.gym JOIN users u ON u.id = m."user"
		WHERE m."user" = $1`, user).Scan(&role, &active, &betas, &platformAdmin)
	if role != "admin" || !active || !betas || !platformAdmin {
		t.Fatalf("role %q active %v betas %v platform admin %v", role, active, betas, platformAdmin)
	}
	if _, err := adminAddMembership(ctx, pool, []string{"--user", user, "--gym", gym}); err != nil {
		t.Fatal(err)
	}
	var left int
	pool.QueryRow(ctx, `SELECT count(*) FROM memberships`).Scan(&left)
	if left != 0 {
		t.Fatalf("%d memberships left", left)
	}
}

func TestAdminTruncatePrefixDeletesOnlyPrefixedTestRows(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	gym, err := adminCreateGym(ctx, pool, []string{"--slug", "e2e", "--name", "E2E Gym"})
	if err != nil {
		t.Fatal(err)
	}
	seed := func(prefix string) (user, route string) {
		user, err := adminCreateUser(ctx, pool, []string{"--email", prefix + "-user@gripello.test", "--password", "E2ePassw0rd!", "--username", prefix + "user"})
		if err != nil {
			t.Fatal(err)
		}
		location, wall, route, role := ids.New(), ids.New(), ids.New(), ids.New()
		for _, statement := range []struct {
			sql  string
			args []any
		}{
			{`INSERT INTO roles (id, gym, name) VALUES ($1, $2, $3)`, []any{role, gym, prefix + "-role"}},
			{`INSERT INTO memberships (id, "user", gym, role) VALUES ($1, $2, $3, $4)`, []any{ids.New(), user, gym, role}},
			{`INSERT INTO locations (id, gym, name) VALUES ($1, $2, $3)`, []any{location, gym, prefix + " Hall"}},
			{`INSERT INTO walls (id, gym, location, name, outline, edge) VALUES ($1, $2, $3, 'North', '[]', '[]')`, []any{wall, gym, location}},
			{`INSERT INTO routes (id, gym, name, grade, location, wall) VALUES ($1, $2, 'Crimp', '6a', $3, $4)`, []any{route, gym, location, wall}},
			{`INSERT INTO ratings (id, gym, route_id, rating, comment) VALUES ($1, $2, $3, 4, 'nice')`, []any{ids.New(), gym, route}},
			{`INSERT INTO ticks (id, "user", route, type, attempts, date, route_name) VALUES ($1, $2, $3, 'top', 1, now(), 'Crimp')`, []any{ids.New(), user, route}},
			{`INSERT INTO seasons (id, gym, name, starts_at, ends_at) VALUES ($1, $2, $3, now(), now())`, []any{ids.New(), gym, prefix + " season"}},
		} {
			if _, err := pool.Exec(ctx, statement.sql, statement.args...); err != nil {
				t.Fatalf("%s: %v", statement.sql, err)
			}
		}
		if _, err := adminCreateNotification(ctx, pool, []string{"--user", user, "--type", "report_filed", "--params", `{"snippet":"x"}`}); err != nil {
			t.Fatal(err)
		}
		return user, route
	}
	seed("e2e-w3-123")
	keptUser, keptRoute := seed("e2e-w13-123")

	if _, err := adminTruncatePrefix(ctx, pool, []string{"--prefix", "e2e"}); err == nil {
		t.Fatal("a short prefix must be refused")
	}
	if _, err := adminTruncatePrefix(ctx, pool, []string{"--prefix", "e2e-w3-"}); err != nil {
		t.Fatal(err)
	}
	var users, routes, rest int
	pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&users)
	pool.QueryRow(ctx, `SELECT count(*) FROM routes WHERE id = $1`, keptRoute).Scan(&routes)
	pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM locations) + (SELECT count(*) FROM walls) + (SELECT count(*) FROM ratings)
		+ (SELECT count(*) FROM ticks) + (SELECT count(*) FROM seasons) + (SELECT count(*) FROM memberships)
		+ (SELECT count(*) FROM notifications) + (SELECT count(*) FROM roles WHERE name LIKE 'e2e-%')`).Scan(&rest)
	if users != 1 || routes != 1 || rest != 8 {
		t.Fatalf("users %d, kept route %d, other rows %d", users, routes, rest)
	}

	if _, err := adminSetUser(ctx, pool, []string{"--user", keptUser, "--verified", "--platform-admin", "--suspended-until", "2099-01-01T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	var verified, platformAdmin, suspended bool
	pool.QueryRow(ctx, `SELECT verified, platform_admin, suspended_until IS NOT NULL FROM users WHERE id = $1`, keptUser).Scan(&verified, &platformAdmin, &suspended)
	if !verified || !platformAdmin || !suspended {
		t.Fatalf("verified %v platform admin %v suspended %v", verified, platformAdmin, suspended)
	}
	if _, err := adminSetUser(ctx, pool, []string{"--user", "e2e-w13-123-user@gripello.test", "--verified=false", "--suspended-until", ""}); err != nil {
		t.Fatal(err)
	}
	pool.QueryRow(ctx, `SELECT verified, platform_admin, suspended_until IS NOT NULL FROM users WHERE id = $1`, keptUser).Scan(&verified, &platformAdmin, &suspended)
	if verified || !platformAdmin || suspended {
		t.Fatalf("after reset: verified %v platform admin %v suspended %v", verified, platformAdmin, suspended)
	}
	if _, err := adminDeleteUser(ctx, pool, []string{"--user", keptUser}); err != nil {
		t.Fatal(err)
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&users)
	if users != 0 {
		t.Fatalf("%d users left", users)
	}
}
