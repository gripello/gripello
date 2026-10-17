package realtime

import (
	"context"
	"testing"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

type fakePerms struct{ permissionHolders, followers, gymViewers []string }

func (f fakePerms) UsersWith(context.Context, string, string) ([]string, error) {
	return f.permissionHolders, nil
}
func (f fakePerms) Followers(context.Context, string) ([]string, error) { return f.followers, nil }
func (f fakePerms) GymViewers(context.Context, string) ([]string, error) {
	if f.gymViewers == nil {
		return []string{"*"}, nil
	}
	return f.gymViewers, nil
}

func TestAudienceCriteriaAreOred(t *testing.T) {
	h := &Hub{perms: fakePerms{permissionHolders: []string{"bob"}}}
	alice := &auth.Principal{UserID: "alice"}
	bob := &auth.Principal{UserID: "bob"}
	aud := events.Audience{Users: []string{"alice"}, GymPerm: "g1:manage_users"}
	if !h.audience(aud)(alice) || !h.audience(aud)(bob) {
		t.Fatal("both the listed user and the permission holder should receive it")
	}
	h = &Hub{perms: fakePerms{}}
	if h.audience(aud)(bob) || !h.audience(aud)(alice) || h.audience(aud)(nil) {
		t.Fatal("without the permission only the listed user remains")
	}
	if h.audience(events.Audience{SignedIn: true, NotUsers: []string{"alice"}})(alice) {
		t.Fatal("NotUsers must exclude")
	}
	if !h.audience(events.Audience{Public: true})(nil) {
		t.Fatal("public reaches guests")
	}
	if !h.audience(events.Audience{GuestsOnly: true})(nil) || h.audience(events.Audience{GuestsOnly: true})(alice) {
		t.Fatal("guests-only must skip signed-in clients")
	}
}

func admits(h *Hub, e events.Event, p *auth.Principal) bool {
	ok, _ := h.accepts(e)(p)
	return ok
}

func TestGymEventsReachOnlyThoseWhoMaySeeTheGym(t *testing.T) {
	h := &Hub{perms: fakePerms{gymViewers: []string{"member"}}}
	member := &auth.Principal{UserID: "member"}
	stranger := &auth.Principal{UserID: "stranger"}
	admin := &auth.Principal{UserID: "admin", PlatformAdmin: true}
	public := events.Event{Topic: "gym_changes:g1", Audience: events.Audience{Public: true}}
	if !admits(h, public, member) || !admits(h, public, admin) || admits(h, public, stranger) || admits(h, public, nil) {
		t.Fatal("a hidden gym's public event must reach only members and platform admins")
	}
	tick := events.Event{Topic: "followed_ticks", Audience: events.Audience{SignedIn: true, Gym: "g1"}}
	if !admits(h, tick, member) || admits(h, tick, stranger) {
		t.Fatal("Audience.Gym must gate topics that don't name the gym")
	}
	addressed := events.Event{Topic: "gym:g1", Audience: events.Audience{Users: []string{"stranger"}}}
	if !admits(h, addressed, stranger) {
		t.Fatal("an event addressed to a user passes the gate")
	}
	if !admits(h, events.Event{Topic: "moderation:platform", Audience: events.Audience{SignedIn: true}}, stranger) {
		t.Fatal("platform moderation names no gym")
	}
	h = &Hub{perms: fakePerms{}}
	if !admits(h, public, nil) {
		t.Fatal("a visible gym's public event reaches guests")
	}
}

func TestWithKindMergesIntoObjects(t *testing.T) {
	cases := map[string]string{
		`{"record":{"id":"r1"}}`: `{"kind":"gym.updated","record":{"id":"r1"}}`,
		`{}`:                     `{"kind":"gym.updated"}`,
		`null`:                   `{"data":null,"kind":"gym.updated"}`,
	}
	for in, want := range cases {
		got := string(withKind(events.Event{Kind: "gym.updated", Payload: []byte(in)}))
		if got != want {
			t.Errorf("%s: got %s want %s", in, got, want)
		}
	}
}

type countingPerms struct{ asked int }

func (c *countingPerms) UsersWith(context.Context, string, string) ([]string, error) {
	c.asked++
	return []string{"bob"}, nil
}
func (c *countingPerms) Followers(context.Context, string) ([]string, error) {
	c.asked++
	return []string{"bob"}, nil
}
func (c *countingPerms) GymViewers(context.Context, string) ([]string, error) {
	return []string{"*"}, nil
}

func TestAudienceAnswersAreCachedUntilPermissionsChange(t *testing.T) {
	perms := &countingPerms{}
	h := &Hub{perms: perms}
	bob := &auth.Principal{UserID: "bob"}
	staff := events.Audience{GymPerm: "g1:manage_tasks"}
	friends := events.Audience{FollowersOf: "alice"}
	for range 3 {
		h.audience(staff)(bob)
		h.audience(friends)(bob)
	}
	if perms.asked != 2 {
		t.Fatalf("asked %d times, want one per distinct audience", perms.asked)
	}
	h.deliver(events.Event{Topic: "gym_changes:g1"})
	h.audience(staff)(bob)
	if perms.asked != 2 {
		t.Fatal("an unrelated event dropped the cache")
	}
	h.deliver(events.Event{Topic: "gym:g1", Kind: "membership.updated"})
	h.audience(staff)(bob)
	if perms.asked != 3 {
		t.Fatal("a membership change must drop cached answers")
	}
}
