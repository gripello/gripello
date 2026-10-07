package hooks

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

func TestDefectRoutes(t *testing.T) {
	task := newTaskRecord()
	task.Set("kind", "reset")
	task.Set("route", "r1")
	if routes := defectRoutes(task); routes != nil {
		t.Errorf("non-defect task broadcast routes %v", routes)
	}

	task.Set("kind", "defect")
	task.Id = "t1"
	if err := task.PostScan(); err != nil {
		t.Fatal(err)
	}
	task.Set("route", "r2")
	if routes := defectRoutes(task); !slices.Equal(routes, []string{"r2", "r1"}) {
		t.Errorf("moved defect routes = %v, want [r2 r1]", routes)
	}

	unrouted := newTaskRecord()
	unrouted.Set("kind", "defect")
	if routes := defectRoutes(unrouted); len(routes) != 0 {
		t.Errorf("defect without route broadcast routes %v", routes)
	}
}

func subscribedClient(topic string, auth *core.Record) *subscriptions.DefaultClient {
	client := subscriptions.NewDefaultClient()
	client.Subscribe(topic)
	if auth != nil {
		client.Set(apis.RealtimeClientAuthKey, auth)
	}
	return client
}

func received(client *subscriptions.DefaultClient) bool {
	select {
	case <-client.Channel():
		return true
	case <-time.After(50 * time.Millisecond):
		return false
	}
}

func TestSendToSubscribersOnlyReachesAcceptedSubscribers(t *testing.T) {
	users := core.NewAuthCollection("users")
	owner := core.NewRecord(users)
	owner.Id = "owner"
	stranger := core.NewRecord(users)
	stranger.Id = "stranger"

	ownerClient := subscribedClient(ownTicksTopic, owner)
	strangerClient := subscribedClient(ownTicksTopic, stranger)
	guestClient := subscribedClient(ownTicksTopic, nil)
	unsubscribedClient := subscribedClient("routes", owner)

	clients := map[string]subscriptions.Client{
		"a": ownerClient, "b": strangerClient, "c": guestClient, "d": unsubscribedClient,
	}
	go sendToSubscribers(clients, ownTicksTopic, subscriptions.Message{Name: ownTicksTopic}, func(auth *core.Record) bool {
		return auth != nil && auth.Id == "owner"
	})

	if !received(ownerClient) {
		t.Error("owner did not receive own tick")
	}
	for name, client := range map[string]*subscriptions.DefaultClient{"stranger": strangerClient, "guest": guestClient, "unsubscribed": unsubscribedClient} {
		if received(client) {
			t.Errorf("%s received another user's tick", name)
		}
	}
}

func TestCompetitionChangeOf(t *testing.T) {
	competition := core.NewRecord(core.NewBaseCollection("competitions"))
	competition.Id = "c1"
	if got := competitionChangeOf(competition); got != (competitionChange{Competition: "c1", Kind: "competition"}) {
		t.Errorf("competition change = %+v", got)
	}

	entry := core.NewRecord(core.NewBaseCollection("competition_entries"))
	entry.Id = "e1"
	entry.Set("competition", "c1")
	entry.Set("user", "u1")
	if got := competitionChangeOf(entry); got != (competitionChange{Competition: "c1", Kind: "entries", User: "u1", Entry: "e1"}) {
		t.Errorf("entry change = %+v", got)
	}

	score := core.NewRecord(core.NewBaseCollection("competition_scores"))
	score.Set("competition", "c1")
	score.Set("entry", "e1")
	if got := competitionChangeOf(score); got != (competitionChange{Competition: "c1", Kind: "scores", Entry: "e1"}) {
		t.Errorf("score change = %+v", got)
	}
}

func TestPublicCompetitionChangeHidesTheParticipant(t *testing.T) {
	change := competitionChange{Competition: "c1", Kind: "entries", User: "u1", Entry: "e1", At: 5}
	if got := publicCompetitionChange(change); got != (competitionChange{Competition: "c1", Kind: "entries", At: 5}) {
		t.Errorf("public change = %+v", got)
	}
}

func gymChangeFrom(t *testing.T, client *subscriptions.DefaultClient) (gymChange, bool) {
	t.Helper()
	select {
	case message := <-client.Channel():
		var change gymChange
		if err := json.Unmarshal(message.Data, &change); err != nil {
			t.Fatal(err)
		}
		return change, true
	case <-time.After(200 * time.Millisecond):
		return gymChange{}, false
	}
}

func TestGymChangesReachOnlyThatGymWithOneAuthorLookup(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "grade_system": "font", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	f.climber.Set("firstname", "Cleo")
	f.climber.Set("name", "Climber")
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}

	topicA, topicB := gymChangesPrefix+f.gymA.Id, gymChangesPrefix+f.gymB.Id
	guest := subscribedClient(topicA, nil)
	other := subscribedClient(topicA, f.setterA)
	author := subscribedClient(topicA, f.climber)
	otherGym := subscribedClient(topicB, f.adminA)
	for _, client := range []*subscriptions.DefaultClient{guest, other, author, otherGym} {
		f.app.SubscriptionsBroker().Register(client)
	}

	saveRecord(t, f.app, "ratings", map[string]any{"route_id": route.Id, "user": f.climber.Id, "rating": 4, "grade": "6a", "grade_system": "font", "comment": "nice"})

	if change, ok := gymChangeFrom(t, guest); !ok || change.Collection != "ratings" || change.Action != "create" || change.Record["author"] != nil || change.Record["user"] != nil {
		t.Errorf("guest got %+v (received %v), want a rating without author or user", change, ok)
	}
	if change, ok := gymChangeFrom(t, other); !ok || change.Record["mine"] != false || change.Record["author"].(map[string]any)["name"] != "Cleo Climber" {
		t.Errorf("signed-in climber got %+v (received %v), want the author and mine=false", change, ok)
	}
	if change, ok := gymChangeFrom(t, author); !ok || change.Record["mine"] != true {
		t.Errorf("author got %+v (received %v), want mine=true", change, ok)
	}
	if _, ok := gymChangeFrom(t, otherGym); ok {
		t.Error("another gym's subscriber received the rating")
	}
}

func TestNotificationsReachOnlyTheirOwner(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	owner := subscribedClient(ownNotifications, f.climber)
	other := subscribedClient(ownNotifications, f.setterA)
	for _, client := range []*subscriptions.DefaultClient{owner, other} {
		f.app.SubscriptionsBroker().Register(client)
	}
	saveRecord(t, f.app, "notifications", map[string]any{"user": f.climber.Id, "type": "new_follower", "params": map[string]any{}})
	if !received(owner) {
		t.Error("owner did not receive the notification")
	}
	if received(other) {
		t.Error("another climber received the notification")
	}
}

func TestCompetitionAndDefectChangesStayInTheirTopic(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	thisCompetition := subscribedClient(competitionsTopic+":c1", nil)
	otherCompetition := subscribedClient(competitionsTopic+":c2", nil)
	thisGym := subscribedClient(openDefectsTopic+":"+f.gymA.Id, nil)
	otherGym := subscribedClient(openDefectsTopic+":"+f.gymB.Id, nil)
	for _, client := range []*subscriptions.DefaultClient{thisCompetition, otherCompetition, thisGym, otherGym} {
		f.app.SubscriptionsBroker().Register(client)
	}

	broadcastCompetitionChange(f.app, competitionChange{Competition: "c1", Kind: "scores"}, func(*core.Record) bool { return true })
	broadcastOpenDefects(f.app, f.gymA.Id, []string{"r1"})

	if !received(thisCompetition) || received(otherCompetition) {
		t.Error("a score change left its competition's topic")
	}
	if !received(thisGym) || received(otherGym) {
		t.Error("a defect change left its gym's topic")
	}
}

func TestGymChangesNeverRevealHiddenFields(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	route := saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "grade_system": "font", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": route.Id, "user": f.climber.Id, "rating": 4, "grade": "6a", "grade_system": "font", "comment": "nice"})
	guest := subscribedClient(gymChangesPrefix+f.gymA.Id, nil)
	f.app.SubscriptionsBroker().Register(guest)

	rating.Unhide(rating.Collection().Fields.FieldNames()...)
	broadcastGymChange(f.app, "update", rating)

	if change, ok := gymChangeFrom(t, guest); !ok || change.Record["user"] != nil {
		t.Errorf("guest got %+v (received %v), want the rating without its hidden author field", change, ok)
	}
}
