package realtime

import (
	"context"
	"testing"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
)

type fakePerms struct{ can, follows bool }

func (f fakePerms) Can(context.Context, string, string, string) bool { return f.can }
func (f fakePerms) Follows(context.Context, string, string) bool     { return f.follows }

func TestAudienceCriteriaAreOred(t *testing.T) {
	h := &Hub{perms: fakePerms{can: true}}
	alice := &auth.Principal{UserID: "alice"}
	bob := &auth.Principal{UserID: "bob"}
	aud := events.Audience{Users: []string{"alice"}, GymPerm: "g1:manage_users"}
	if !h.accepts(aud, alice) || !h.accepts(aud, bob) {
		t.Fatal("both the listed user and the permission holder should receive it")
	}
	h = &Hub{perms: fakePerms{}}
	if h.accepts(aud, bob) || !h.accepts(aud, alice) || h.accepts(aud, nil) {
		t.Fatal("without the permission only the listed user remains")
	}
	if h.accepts(events.Audience{SignedIn: true, NotUsers: []string{"alice"}}, alice) {
		t.Fatal("NotUsers must exclude")
	}
	if !h.accepts(events.Audience{Public: true}, nil) {
		t.Fatal("public reaches guests")
	}
	if !h.accepts(events.Audience{GuestsOnly: true}, nil) || h.accepts(events.Audience{GuestsOnly: true}, alice) {
		t.Fatal("guests-only must skip signed-in clients")
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

func (c *countingPerms) Can(context.Context, string, string, string) bool { c.asked++; return true }
func (c *countingPerms) Follows(context.Context, string, string) bool     { c.asked++; return true }

func TestAudienceAnswersAreCachedUntilPermissionsChange(t *testing.T) {
	perms := &countingPerms{}
	h := &Hub{perms: perms}
	bob := &auth.Principal{UserID: "bob"}
	staff := events.Audience{GymPerm: "g1:manage_tasks"}
	friends := events.Audience{FollowersOf: "alice"}
	for range 3 {
		h.accepts(staff, bob)
		h.accepts(friends, bob)
	}
	if perms.asked != 2 {
		t.Fatalf("asked %d times, want one per distinct question", perms.asked)
	}
	h.deliver(events.Event{Topic: "gym_changes:g1"})
	h.accepts(staff, bob)
	if perms.asked != 2 {
		t.Fatal("an unrelated event dropped the cache")
	}
	h.deliver(events.Event{Topic: "gym:g1", Kind: "membership.updated"})
	h.accepts(staff, bob)
	if perms.asked != 3 {
		t.Fatal("a membership change must drop cached answers")
	}
}
