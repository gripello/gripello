package tenancy

import (
	"context"
	"slices"
	"testing"

	"gripello/internal/platform/db"
	"gripello/internal/platform/testkit"
)

func TestAudienceSetsMatchTheSingleQuestions(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
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
