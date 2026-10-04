package hooks

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func savePushSubscription(t *testing.T, app core.App, userID, endpoint string) *core.Record {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	rand.Read(secret)
	return saveRecord(t, app, "push_subscriptions", map[string]any{
		"user":     userID,
		"endpoint": endpoint,
		"p256dh":   base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		"auth":     base64.RawURLEncoding.EncodeToString(secret),
	})
}

func notificationsOf(t *testing.T, app core.App, userID, notificationType string) []*core.Record {
	t.Helper()
	rows, err := app.FindAllRecords("notifications", dbx.HashExp{"user": userID, "type": notificationType})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestPushTextReadsTheAppLocales(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "en.json"), []byte(`{"notifications":{"center":{"types":{"task_assigned":"Assigned: {title}","report_filed":"Report"}}}}`), 0o644)
	os.WriteFile(filepath.Join(dir, "de.json"), []byte(`{"notifications":{"center":{"types":{"task_assigned":"Zugewiesen: {title}"}}}}`), 0o644)
	messages := loadPushMessages(dir)

	if got := pushText(messages, "de", "task_assigned", map[string]any{"title": "Griff"}); got != "Zugewiesen: Griff" {
		t.Errorf("de = %q", got)
	}
	if got := pushText(messages, "de", "report_filed", nil); got != "Report" {
		t.Errorf("missing key falls back to en, got %q", got)
	}
	if got := pushText(messages, "", "task_assigned", map[string]any{"title": 3}); got != "Assigned: 3" {
		t.Errorf("no language = %q", got)
	}
}

func TestPushTextCoversEveryNotificationTypeInTheRealLocales(t *testing.T) {
	messages := loadPushMessages(filepath.Join("..", "..", "i18n", "locales"))
	if len(messages) == 0 {
		t.Skip("i18n/locales is outside the docker test context")
	}
	for _, notificationType := range []string{"task_defect_filed", "task_defect_fixed", "task_assigned", "report_filed", "report_decided_kept", "report_decided_removed", "wall_new_routes", "competition_published"} {
		for language, types := range messages {
			if types[notificationType] == "" {
				t.Errorf("%s has no %s", language, notificationType)
			}
		}
	}
}

func TestOnlyPushServiceEndpointsAreAccepted(t *testing.T) {
	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/abc",
		"https://web.push.apple.com/QGx",
		"https://updates.push.services.mozilla.com/wpush/v2/x",
		"https://wns2-db5p.notify.windows.com/w/?token=x",
	} {
		if !isPushServiceEndpoint(endpoint) {
			t.Errorf("rejected %s", endpoint)
		}
	}
	for _, endpoint := range []string{
		"http://fcm.googleapis.com/fcm/send/abc",
		"https://127.0.0.1/api/collections",
		"https://localhost:8080/",
		"https://fcm.googleapis.com.evil.example/x",
		"https://evilpush.apple.com/x",
		"https://fcm.googleapis.com:8443/x",
		"not a url",
	} {
		if isPushServiceEndpoint(endpoint) {
			t.Errorf("accepted %s", endpoint)
		}
	}
}

func TestWantsNotificationDefaultsToOn(t *testing.T) {
	user := core.NewRecord(core.NewBaseCollection("users"))
	if !wantsNotification(user, pushChannel, "task_assigned") {
		t.Error("no prefs muted a notification")
	}
	user.Set("notification_prefs", `{"push":{"tasks":false},"email":{"new_routes":false}}`)
	if wantsNotification(user, pushChannel, "task_assigned") {
		t.Error("muted tasks topic still pushed")
	}
	if !wantsNotification(user, pushChannel, "report_filed") {
		t.Error("muting tasks also muted reports")
	}
	if !wantsNotification(user, pushChannel, "wall_new_routes") {
		t.Error("email preference leaked into push")
	}
	if !wantsNotification(user, pushChannel, "some_future_type") {
		t.Error("type without a topic must not be muted")
	}
}

func TestEveryNotificationTypeHasATopic(t *testing.T) {
	messages := loadPushMessages(filepath.Join("..", "..", "i18n", "locales"))
	if len(messages) == 0 {
		t.Skip("i18n/locales is outside the docker test context")
	}
	for notificationType := range messages["en"] {
		if !strings.HasSuffix(notificationType, "_gym") && topicOf(notificationType) == "" {
			t.Errorf("%s belongs to no topic in notificationTopics", notificationType)
		}
	}
}

func TestPushDeliveriesHonourMutedTopics(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	savePushSubscription(t, f.app, f.adminA.Id, "https://push.example/a")
	savePushSubscription(t, f.app, f.climber.Id, "https://push.example/c")
	f.climber.Set("notification_prefs", map[string]any{"push": map[string]bool{"tasks": false, "defect_fixed": true}})
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	messages := map[string]map[string]string{"en": {"task_assigned": "Assigned"}}

	staff := pushDeliveries(f.app, messages, []*core.Record{f.adminA, f.climber, f.setterA}, notification{Gym: f.gymA.Id, Type: "task_assigned"})
	if len(staff) != 1 || staff[0].subscription.Endpoint != "https://push.example/a" {
		t.Fatalf("staff deliveries = %+v", staff)
	}
	if !json.Valid(staff[0].payload) || !strings.Contains(string(staff[0].payload), `"title":"A"`) {
		t.Errorf("payload = %s", staff[0].payload)
	}
	fixed := pushDeliveries(f.app, messages, []*core.Record{f.climber}, notification{Type: "task_defect_fixed"})
	if len(fixed) != 1 {
		t.Errorf("defect_fixed is not muted, got %d deliveries", len(fixed))
	}
}

func TestSubscriptionEndpointMovesToTheLatestUser(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	savePushSubscription(t, f.app, f.adminA.Id, "https://push.example/shared")
	savePushSubscription(t, f.app, f.climber.Id, "https://push.example/shared")

	rows, err := f.app.FindAllRecords("push_subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].GetString("user") != f.climber.Id {
		t.Fatalf("subscriptions = %v", rows)
	}
}

func TestDeliverPushDropsGoneSubscriptions(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	gone := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusGone) }))
	defer gone.Close()
	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) }))
	defer alive.Close()
	savePushSubscription(t, f.app, f.climber.Id, gone.URL)
	kept := savePushSubscription(t, f.app, f.climber.Id, alive.URL)

	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	deliveries := pushDeliveries(f.app, map[string]map[string]string{}, []*core.Record{f.climber}, notification{Type: "task_defect_fixed"})
	deliverPush(f.app, deliveries, &webpush.Options{Subscriber: "test@example.com", VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, TTL: 60})

	rows, _ := f.app.FindAllRecords("push_subscriptions")
	if len(rows) != 1 || rows[0].Id != kept.Id {
		t.Fatalf("subscriptions after 410 = %v", rows)
	}
}

func TestWallDigestNotifiesFollowersOncePerWall(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id, "map": map[string]any{"width": 40, "height": 30, "shapes": []any{
		map[string]any{"kind": "floor", "points": [][]float64{{0, 0}, {40, 0}, {40, 30}, {0, 30}}},
	}}})
	wall := saveRecord(t, f.app, "walls", map[string]any{
		"location": hall.Id, "name": "North",
		"outline": [][]float64{{2, 2}, {38, 2}, {38, 5}, {2, 5}}, "edge": [][]float64{{2, 5}, {38, 5}},
	})
	for _, name := range []string{"One", "Two", "Three"} {
		saveRecord(t, f.app, "routes", map[string]any{"name": name, "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id, "wall": wall.Id})
	}
	f.climber.Set("followed_walls", []string{wall.Id})
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}

	notifyWallNewRoutes(f.app, time.Now().Add(wallDigestWindow))

	rows := notificationsOf(t, f.app, f.climber.Id, "wall_new_routes")
	if len(rows) != 1 {
		t.Fatalf("follower got %d digests", len(rows))
	}
	var params map[string]any
	rows[0].UnmarshalJSONField("params", &params)
	if params["wall"] != "North" || params["count"] != float64(3) || rows[0].GetString("url") != "/gym-a/map?wall="+wall.Id {
		t.Errorf("digest = %v %s", params, rows[0].GetString("url"))
	}
	if len(notificationsOf(t, f.app, f.setterA.Id, "wall_new_routes")) != 0 {
		t.Error("non-follower notified")
	}

	notifyWallNewRoutes(f.app, time.Now().Add(3*wallDigestWindow))
	if len(notificationsOf(t, f.app, f.climber.Id, "wall_new_routes")) != 1 {
		t.Error("later window repeated the digest")
	}
}

func TestPublishingACompetitionNotifiesEntrants(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()

	competition, _ := saveCompetition(t, f.app, f.gymA.Id)
	category := saveRecord(t, f.app, "competition_categories", map[string]any{"name": "Open", "competition": competition.Id})
	for bib, entrant := range map[int]struct {
		user   *core.Record
		status string
	}{1: {f.climber, "checked_in"}, 2: {f.setterB, "withdrawn"}} {
		saveRecord(t, f.app, "competition_entries", map[string]any{
			"competition": competition.Id, "category": category.Id, "user": entrant.user.Id,
			"display_name": "X", "birth_year": 1990, "status": entrant.status, "bib": bib,
		})
	}

	competition, _ = f.app.FindRecordById("competitions", competition.Id)
	competition.Set("status", "published")
	if err := f.app.Save(competition); err != nil {
		t.Fatal(err)
	}

	if rows := notificationsOf(t, f.app, f.climber.Id, "competition_published"); len(rows) != 1 {
		t.Errorf("entrant got %d notifications", len(rows))
	}
	if rows := notificationsOf(t, f.app, f.setterB.Id, "competition_published"); len(rows) != 0 {
		t.Error("withdrawn entrant notified")
	}
}
