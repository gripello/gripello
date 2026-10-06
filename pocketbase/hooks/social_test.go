package hooks

import (
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func setFollowPolicy(t *testing.T, app core.App, user *core.Record, policy string) {
	t.Helper()
	user.Set("follow_policy", policy)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
}

func followOf(t *testing.T, app core.App, follower, followee *core.Record) *core.Record {
	t.Helper()
	follow, err := app.FindFirstRecordByFilter("follows", "follower = {:a} && followee = {:b}", dbx.Params{"a": follower.Id, "b": followee.Id})
	if err != nil {
		t.Fatalf("follow %s → %s: %v", follower.Email(), followee.Email(), err)
	}
	return follow
}

func TestFollowPolicies(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	follows := "/api/collections/follows/records"
	body := func(follower, followee *core.Record) string {
		return `{"follower":"` + follower.Id + `","followee":"` + followee.Id + `","status":"accepted"}`
	}
	setFollowPolicy(t, f.app, f.setterA, "open")
	setFollowPolicy(t, f.app, f.setterB, "closed")

	call(t, f.app, f.climber, http.MethodPost, follows, body(f.climber, f.adminA), http.StatusOK, `"status":"pending"`)
	call(t, f.app, f.climber, http.MethodPost, follows, body(f.climber, f.setterA), http.StatusOK, `"status":"accepted"`)
	call(t, f.app, f.climber, http.MethodPost, follows, body(f.climber, f.setterB), http.StatusForbidden)
	call(t, f.app, f.climber, http.MethodPost, follows, body(f.climber, f.climber), http.StatusBadRequest)
	call(t, f.app, f.climber, http.MethodPost, follows, body(f.adminA, f.setterA), http.StatusBadRequest)
	call(t, f.app, f.climber, http.MethodPost, follows, body(f.climber, f.adminA), http.StatusBadRequest)

	if len(notificationsOf(t, f.app, f.adminA.Id, "follow_requested")) != 1 || len(notificationsOf(t, f.app, f.setterA.Id, "new_follower")) != 1 {
		t.Error("followees were not notified")
	}

	pending := followOf(t, f.app, f.climber, f.adminA)
	call(t, f.app, f.climber, http.MethodPatch, recordURL("follows", pending.Id), `{"status":"accepted"}`, http.StatusNotFound)
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("follows", pending.Id), `{"followee":"`+f.setterA.Id+`"}`, http.StatusNotFound)
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("follows", pending.Id), `{"status":"accepted"}`, http.StatusOK)
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("follows", pending.Id), `{"status":"pending"}`, http.StatusBadRequest)
	if len(notificationsOf(t, f.app, f.climber.Id, "follow_accepted")) != 1 {
		t.Error("follower was not told about the accepted request")
	}

	call(t, f.app, f.setterB, http.MethodGet, follows, "", http.StatusOK, `"totalItems":0`)
	call(t, f.app, f.adminA, http.MethodDelete, recordURL("follows", pending.Id), "", http.StatusNoContent)
}

func TestFriendTicksOnlyReachAcceptedFollowers(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	for _, user := range []*core.Record{f.setterA, f.adminA} {
		saveRecord(t, f.app, "ticks", map[string]any{"user": user.Id, "route": route.Id, "type": "top", "attempts": 2, "date": time.Now(), "note": "secret " + user.Email()})
	}
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.setterA.Id, "status": "pending"})
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.adminA.Id, "status": "pending"})
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.setterB.Id, "followee": f.adminA.Id, "status": "pending"})
	for _, follow := range []*core.Record{followOf(t, f.app, f.setterB, f.adminA)} {
		follow.Set("status", "accepted")
		if err := f.app.Save(follow); err != nil {
			t.Fatal(err)
		}
	}

	friendTicks := "/api/collections/friend_ticks/records"
	call(t, f.app, f.climber, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":0`)
	call(t, f.app, nil, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":0`)

	accepted := followOf(t, f.app, f.climber, f.setterA)
	accepted.Set("status", "accepted")
	if err := f.app.Save(accepted); err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.climber, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":1`, `"user":"`+f.setterA.Id+`"`)
	call(t, f.app, f.setterB, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":1`, `"user":"`+f.adminA.Id+`"`)
	call(t, f.app, f.setterA, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":0`)

	if got := acceptedFollowers(f.app, f.adminA.Id); len(got) != 1 || got[0] != f.setterB.Id {
		t.Errorf("accepted followers of admin = %v", got)
	}
}

func TestFriendTicksHideNotes(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	collection, err := f.app.FindCollectionByNameOrId("friend_ticks")
	if err != nil {
		t.Fatal(err)
	}
	if collection.Fields.GetByName("note") != nil {
		t.Error("friend_ticks exposes private notes")
	}
	if relation, ok := collection.Fields.GetByName("user").(*core.RelationField); !ok || relation.CollectionId != "_pb_users_auth_" {
		t.Error("friend_ticks.user is not a users relation")
	}
}

func TestClimberLookups(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	for user, name := range map[*core.Record][2]string{f.setterA: {"Sam", "Setter"}, f.setterB: {"Sam", "Hidden"}, f.adminA: {"Ada", "Admin"}} {
		user.Set("firstname", name[0])
		user.Set("name", name[1])
		if err := f.app.Save(user); err != nil {
			t.Fatal(err)
		}
	}
	setFollowPolicy(t, f.app, f.setterB, "closed")

	call(t, f.app, nil, http.MethodGet, "/api/climbers?q=sam", "", http.StatusUnauthorized)
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers?q=sam", "", http.StatusOK, `"name":"Sam Setter"`)
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers?q=sam+set", "", http.StatusOK, `"name":"Sam Setter"`)
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers?q=s", "", http.StatusOK, `[]`)
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers/"+f.setterB.Id, "", http.StatusNotFound)
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers?ids="+f.setterB.Id+","+f.adminA.Id, "", http.StatusOK, `[{"id":"`+f.adminA.Id+`","name":"Ada Admin","avatar":""}]`)

	setFollowPolicy(t, f.app, f.climber, "open")
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.setterB.Id, "followee": f.climber.Id})
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers/"+f.setterB.Id, "", http.StatusOK, `"closed":true`, `"following":1`)
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers/"+f.climber.Id, "", http.StatusOK, `"followers":1`)
}

func TestReviewAuthors(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	f.setterA.Set("firstname", "Sam")
	f.setterA.Set("name", "Setter")
	if err := f.app.Save(f.setterA); err != nil {
		t.Fatal(err)
	}
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	ratings := "/api/collections/ratings/records"

	call(t, f.app, f.setterA, http.MethodPost, ratings, `{"route_id":"`+route.Id+`","rating":4,"comment":"nice","user":"`+f.climber.Id+`"}`, http.StatusOK, `"author":{"id":"`+f.setterA.Id+`","name":"Sam Setter"`, `"mine":true`)
	review, err := f.app.FindFirstRecordByFilter("ratings", "route_id = {:route}", dbx.Params{"route": route.Id})
	if err != nil || review.GetString("user") != f.setterA.Id {
		t.Fatalf("review author = %q, %v", review.GetString("user"), err)
	}

	call(t, f.app, f.climber, http.MethodGet, ratings, "", http.StatusOK, `"name":"Sam Setter"`, `"mine":false`)
	call(t, f.app, nil, http.MethodGet, ratings, "", http.StatusOK, `"totalItems":1`)
	call(t, f.app, nil, http.MethodGet, ratings+"?filter=user!=''", "", http.StatusBadRequest)

	f.setterA.Set("reviews_anonymous", true)
	if err := f.app.Save(f.setterA); err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.climber, http.MethodGet, ratings, "", http.StatusOK, `"mine":false`)

	call(t, f.app, f.climber, http.MethodDelete, recordURL("ratings", review.Id), "", http.StatusNotFound)
	call(t, f.app, f.setterA, http.MethodDelete, recordURL("ratings", review.Id), "", http.StatusNoContent)
}

func TestPrivateSendsStayOffTheFeed(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	saveRecord(t, f.app, "ticks", map[string]any{"user": f.setterA.Id, "route": route.Id, "type": "top", "attempts": 1, "date": time.Now()})
	setFollowPolicy(t, f.app, f.setterA, "open")
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.setterA.Id})

	friendTicks := "/api/collections/friend_ticks/records"
	call(t, f.app, f.climber, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":1`)
	f.setterA.Set("ticks_private", true)
	if err := f.app.Save(f.setterA); err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.climber, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":0`)
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers/"+f.setterA.Id, "", http.StatusOK, `"private":true`)
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("users", f.setterA.Id), `{"ticks_private":false}`, http.StatusNotFound)
}

func TestPendingRequestsOnlyOpenProfilesToTheFollowee(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.setterB.Id})
	setFollowPolicy(t, f.app, f.setterB, "closed")
	setFollowPolicy(t, f.app, f.climber, "closed")

	call(t, f.app, f.climber, http.MethodGet, "/api/climbers/"+f.setterB.Id, "", http.StatusNotFound)
	call(t, f.app, f.setterB, http.MethodGet, "/api/climbers/"+f.climber.Id, "", http.StatusOK)

	follow := followOf(t, f.app, f.climber, f.setterB)
	follow.Set("status", "accepted")
	if err := f.app.Save(follow); err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.climber, http.MethodGet, "/api/climbers/"+f.setterB.Id, "", http.StatusOK)
}

func TestFriendTicksShowEachViewerOnlyTheirFollowees(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	tick := saveRecord(t, f.app, "ticks", map[string]any{"user": f.setterA.Id, "route": route.Id, "type": "top", "attempts": 1, "date": time.Now()})
	setFollowPolicy(t, f.app, f.setterA, "open")
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.setterA.Id})
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.adminA.Id, "followee": f.setterA.Id})
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.setterB.Id, "followee": f.climber.Id})

	friendTicks := "/api/collections/friend_ticks/records"
	for _, follower := range []*core.Record{f.climber, f.adminA} {
		call(t, f.app, follower, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":1`, `"id":"`+tick.Id+`"`)
	}
	call(t, f.app, f.setterB, http.MethodGet, friendTicks, "", http.StatusOK, `"totalItems":0`)
	call(t, f.app, f.climber, http.MethodGet, recordURL("friend_ticks", tick.Id), "", http.StatusOK)
	call(t, f.app, f.setterB, http.MethodGet, recordURL("friend_ticks", tick.Id), "", http.StatusNotFound)
}
