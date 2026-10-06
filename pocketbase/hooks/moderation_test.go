package hooks

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/types"
)

type moderationFixture struct {
	memberFixture
	operator *core.Record
	route    *core.Record
}

func newModerationFixture(t *testing.T) moderationFixture {
	t.Helper()
	f := moderationFixture{memberFixture: newMemberFixture(t)}
	f.operator = saveUser(t, f.app, "operator@example.com")
	f.operator.Set("platform_admin", true)
	if err := f.app.Save(f.operator); err != nil {
		t.Fatal(err)
	}
	hall := saveRecord(t, f.app, "locations", map[string]any{"name": "Hall", "gym": f.gymA.Id})
	f.route = saveRecord(t, f.app, "routes", map[string]any{"name": "Crimp", "grade": "6a", "type": "Boulder", "creator": []string{"S"}, "location": hall.Id})
	return f
}

func (f moderationFixture) item(t *testing.T, kind, contentID string) *core.Record {
	t.Helper()
	item := findModerationItem(f.app, kind, contentID)
	if item == nil {
		t.Fatalf("no %s moderation item for %s", kind, contentID)
	}
	return item
}

func moderationAction(action string) string {
	return `{"action":"` + action + `","reason":"spam"}`
}

func TestModerationQueuesAndHidesReviews(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	silent := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.setterB.Id, "rating": 3})
	if findModerationItem(f.app, "rating", silent.Id) != nil {
		t.Error("a rating without comment was queued")
	}
	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 4, "comment": "buy pills"})
	item := f.item(t, "rating", rating.Id)
	if item.GetString("state") != "unreviewed" || item.GetString("gym") != f.gymA.Id || item.GetString("author") != f.climber.Id {
		t.Fatalf("queued item = %v", item.FieldsData())
	}
	url := "/api/moderation/" + item.Id

	call(t, f.app, f.climber, http.MethodPost, url, moderationAction("hide"), http.StatusNotFound)
	call(t, f.app, f.setterB, http.MethodPost, url, moderationAction("hide"), http.StatusNotFound)
	call(t, f.app, f.setterB, http.MethodGet, recordURL("moderation_items", item.Id), "", http.StatusNotFound)
	call(t, f.app, f.setterA, http.MethodGet, recordURL("moderation_items", item.Id), "", http.StatusOK)
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("approve"), http.StatusOK, `"state":"approved"`)

	rating, _ = f.app.FindRecordById("ratings", rating.Id)
	rating.Set("comment", "buy more pills")
	if err := f.app.Save(rating); err != nil {
		t.Fatal(err)
	}
	if state := f.item(t, "rating", rating.Id).GetString("state"); state != "unreviewed" {
		t.Errorf("edited review state = %q, want unreviewed", state)
	}

	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("hide"), http.StatusOK, `"hidden_by":"gym"`)
	if _, err := f.app.FindRecordById("ratings", rating.Id); err == nil {
		t.Error("hidden review is still public")
	}
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("restore"), http.StatusOK, `"state":"approved"`)
	restored, err := f.app.FindRecordById("ratings", rating.Id)
	if err != nil || restored.GetString("comment") != "buy more pills" || restored.GetString("user") != f.climber.Id {
		t.Fatalf("restored review = %v, %v", restored, err)
	}

	call(t, f.app, f.operator, http.MethodPost, url, moderationAction("hide"), http.StatusOK, `"hidden_by":"platform"`)
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("restore"), http.StatusForbidden)
	call(t, f.app, f.operator, http.MethodPost, url, moderationAction("restore"), http.StatusOK)

	call(t, f.app, f.climber, http.MethodDelete, recordURL("ratings", rating.Id), "", http.StatusNoContent)
	if findModerationItem(f.app, "rating", rating.Id) != nil {
		t.Error("deleting a review kept its queue item")
	}
}

func TestModerationQuarantinesFiles(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	collection, err := f.app.FindCollectionByNameOrId("beta_videos")
	if err != nil {
		t.Fatal(err)
	}
	video := core.NewRecord(collection)
	file, err := filesystem.NewFileFromBytes([]byte("\x00\x00\x00\x18ftypmp42"), "beta.mp4")
	if err != nil {
		t.Fatal(err)
	}
	video.Load(map[string]any{"user": f.climber.Id, "route": f.route.Id})
	video.Set("file", file)
	if err := f.app.Save(video); err != nil {
		t.Fatal(err)
	}
	item := f.item(t, "beta_video", video.Id)
	url := "/api/moderation/" + item.Id

	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("hide"), http.StatusOK)
	if hidden := f.item(t, "beta_video", video.Id); len(hidden.GetStringSlice("files")) != 1 {
		t.Fatalf("quarantined files = %v", hidden.GetStringSlice("files"))
	}
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("restore"), http.StatusOK)
	restored, err := f.app.FindRecordById("beta_videos", video.Id)
	if err != nil || restored.GetString("file") == "" {
		t.Fatalf("restored beta = %v, %v", restored, err)
	}
	if settled := f.item(t, "beta_video", video.Id); len(settled.GetStringSlice("files")) != 0 {
		t.Errorf("restore left quarantined files: %v", settled.GetStringSlice("files"))
	}
}

func TestModerationOfProfilesIsPlatformOnly(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	f.climber.Set("firstname", "Rude")
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	item := f.item(t, "profile", f.climber.Id)
	url := "/api/moderation/" + item.Id
	username := f.climber.GetString("username")

	call(t, f.app, f.adminA, http.MethodPost, url, moderationAction("hide"), http.StatusNotFound)
	call(t, f.app, f.operator, http.MethodPost, url, moderationAction("hide"), http.StatusOK)
	hidden, _ := f.app.FindRecordById("users", f.climber.Id)
	if hidden.GetString("firstname") != "" || hidden.GetString("username") != "climber_"+f.climber.Id {
		t.Errorf("hidden profile = %q / %q", hidden.GetString("firstname"), hidden.GetString("username"))
	}
	call(t, f.app, f.operator, http.MethodPost, url, moderationAction("restore"), http.StatusOK)
	restored, _ := f.app.FindRecordById("users", f.climber.Id)
	if restored.GetString("firstname") != "Rude" || restored.GetString("username") != username {
		t.Errorf("restored profile = %q / %q", restored.GetString("firstname"), restored.GetString("username"))
	}
}

func TestPendingBetaNeedsTheGym(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	pending := saveRecord(t, f.app, "moderation_items", map[string]any{
		"gym": f.gymA.Id, "content_type": "beta_video", "content_id": "pendingbeta0001", "author": f.climber.Id, "state": "pending",
		"snapshot": map[string]any{"gym": f.gymA.Id, "route": f.route.Id, "user": f.climber.Id, "url": "https://youtube.com/shorts/1"},
	})
	url := "/api/moderation/" + pending.Id

	call(t, f.app, f.operator, http.MethodPost, url, moderationAction("approve"), http.StatusForbidden)
	call(t, f.app, f.operator, http.MethodPost, url, moderationAction("hide"), http.StatusOK, `"hidden_by":"platform"`)
	call(t, f.app, f.operator, http.MethodPost, url, moderationAction("restore"), http.StatusOK, `"state":"pending"`)
	if _, err := f.app.FindRecordById("beta_videos", "pendingbeta0001"); err == nil {
		t.Fatal("restoring a pending upload published it")
	}
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("approve"), http.StatusOK, `"state":"approved"`)
	if video, err := f.app.FindRecordById("beta_videos", "pendingbeta0001"); err != nil || video.GetString("user") != f.climber.Id {
		t.Fatalf("approved beta = %v, %v", video, err)
	}
}

func TestReportsRaiseTheQueue(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	report := func(contentType, contentID string) *core.Record {
		return saveRecord(t, f.app, "reports", map[string]any{
			"content_type": contentType, "content_id": contentID, "content_url": "/", "reason": "spam_fraud", "gym": f.gymB.Id,
			"explanation": "Spam", "notifier_name": "N", "notifier_email": "n@example.com", "good_faith": true, "status": "open",
		})
	}
	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 4, "comment": "spam"})
	call(t, f.app, f.setterA, http.MethodPost, "/api/moderation/"+f.item(t, "rating", rating.Id).Id, moderationAction("approve"), http.StatusOK)
	report("rating", rating.Id)
	report("rating", rating.Id)
	item := f.item(t, "rating", rating.Id)
	if item.GetInt("reports_count") != 2 || item.GetString("state") != "unreviewed" {
		t.Errorf("reported item = %d reports, %s", item.GetInt("reports_count"), item.GetString("state"))
	}

	profileReport := report("profile", f.climber.Id)
	if profileReport.GetString("gym") != "" {
		t.Errorf("profile report gym = %q, want none", profileReport.GetString("gym"))
	}
	if got := reportedContentURL(f.app, profileReport); got != "/climber?id="+f.climber.Id {
		t.Errorf("profile report url = %q", got)
	}
	call(t, f.app, f.operator, http.MethodGet, recordURL("reports", profileReport.Id), "", http.StatusOK)
	call(t, f.app, f.adminA, http.MethodGet, recordURL("reports", profileReport.Id), "", http.StatusNotFound)
}

func TestRemovingReportedContentHidesIt(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 4, "comment": "hate"})
	report := saveRecord(t, f.app, "reports", map[string]any{
		"content_type": "rating", "content_id": rating.Id, "content_url": "/", "reason": "hate_speech",
		"explanation": "Hate", "notifier_name": "N", "notifier_email": "n@example.com", "good_faith": true, "status": "open",
	})
	if total, _ := f.app.CountRecords("notifications", dbx.HashExp{"user": f.operator.Id, "type": "report_filed_platform"}); total != 1 {
		t.Errorf("platform admin got %d escalations, want 1", total)
	}
	removal := `{"status":"actioned","decision":"content_removed","decision_reason":"hate speech"}`

	call(t, f.app, f.adminB(t), http.MethodPatch, recordURL("reports", report.Id), removal, http.StatusNotFound)
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("reports", report.Id), removal, http.StatusOK)
	if _, err := f.app.FindRecordById("ratings", rating.Id); err == nil {
		t.Error("removed review is still public")
	}
	item := f.item(t, "rating", rating.Id)
	if item.GetString("state") != "hidden" || item.GetString("reason") != "hate speech" || item.GetString("reviewed_by") != f.adminA.Id {
		t.Errorf("hidden item = %v", item.FieldsData())
	}
}

func (f moderationFixture) adminB(t *testing.T) *core.Record {
	t.Helper()
	admin := saveUser(t, f.app, "admin-b@example.com")
	saveRecord(t, f.app, "memberships", map[string]any{"user": admin.Id, "gym": f.gymB.Id, "role": gymRole(t, f.app, f.gymB.Id, "admin").Id})
	return admin
}

func TestPremoderatedUploadsWaitForTheGym(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	f.gymA.Set("premoderate_betas", true)
	if err := f.app.Save(f.gymA); err != nil {
		t.Fatal(err)
	}
	videos := "/api/collections/beta_videos/records"
	body := func(user string) string {
		return `{"user":"` + user + `","route":"` + f.route.Id + `","url":"https://youtube.com/shorts/123"}`
	}
	call(t, f.app, f.climber, http.MethodPost, videos, `{"user":"`+f.climber.Id+`","route":"`+f.route.Id+`","url":"https://example.com/x"}`, http.StatusBadRequest)
	call(t, f.app, f.climber, http.MethodPost, videos, body(f.climber.Id), http.StatusAccepted, `"pending":true`)
	if total, _ := f.app.CountRecords("beta_videos"); total != 0 {
		t.Fatalf("a held upload was published (%d videos)", total)
	}
	if total, _ := f.app.CountRecords("notifications", dbx.HashExp{"user": f.setterA.Id, "type": "moderation_pending"}); total != 1 {
		t.Errorf("gym staff got %d pending notices, want 1", total)
	}
	call(t, f.app, f.setterA, http.MethodPost, videos, body(f.setterA.Id), http.StatusOK)

	pending, err := f.app.FindFirstRecordByFilter("moderation_items", "state = 'pending'")
	if err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.setterA, http.MethodPost, "/api/moderation/"+pending.Id, moderationAction("approve"), http.StatusOK)
	video, err := f.app.FindRecordById("beta_videos", pending.GetString("content_id"))
	if err != nil || video.GetString("user") != f.climber.Id || video.GetString("gym") != f.gymA.Id {
		t.Fatalf("approved upload = %v, %v", video, err)
	}
	if total, _ := f.app.CountRecords("notifications", dbx.HashExp{"user": f.climber.Id, "type": "beta_approved"}); total != 1 {
		t.Errorf("author got %d approval notices, want 1", total)
	}
}

func TestSuspendedClimbersCannotSignIn(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	f.climber.SetVerified(true)
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	suspension := "/api/platform/users/" + f.climber.Id + "/suspension"
	until := `{"until":"2099-01-01 00:00:00.000Z","reason":"spam"}`
	login := `{"identity":"climber@example.com","password":"1234567890"}`
	auth := "/api/collections/users/auth-with-password"

	call(t, f.app, f.adminA, http.MethodPost, suspension, until, http.StatusForbidden)
	call(t, f.app, f.operator, http.MethodPost, "/api/platform/users/"+f.operator.Id+"/suspension", until, http.StatusForbidden)
	call(t, f.app, f.operator, http.MethodPost, suspension, `{"until":"2000-01-01 00:00:00.000Z"}`, http.StatusBadRequest)
	call(t, f.app, f.operator, http.MethodPost, suspension, until, http.StatusNoContent)
	call(t, f.app, f.climber, http.MethodGet, recordURL("users", f.climber.Id), "", http.StatusNotFound)
	call(t, f.app, nil, http.MethodPost, auth, login, http.StatusForbidden, "suspended")
	call(t, f.app, f.climber, http.MethodPatch, recordURL("users", f.climber.Id), `{"suspended_until":""}`, http.StatusNotFound)

	call(t, f.app, f.setterA, http.MethodPatch, recordURL("users", f.setterA.Id), `{"suspension_reason":"x"}`, http.StatusNotFound)
	call(t, f.app, f.operator, http.MethodPatch, recordURL("users", f.setterA.Id), `{"suspended_until":""}`, http.StatusNotFound)
	call(t, f.app, f.operator, http.MethodDelete, suspension, "", http.StatusNoContent)
	call(t, f.app, nil, http.MethodPost, auth, login, http.StatusOK)

	call(t, f.app, f.operator, http.MethodPost, suspension, `{"permanent":true,"reason":"illegal content"}`, http.StatusNoContent)
	call(t, f.app, nil, http.MethodPost, auth, login, http.StatusForbidden, "suspended")
	if user, _ := f.app.FindRecordById("users", f.climber.Id); !user.GetDateTime("suspended_until").Equal(permanentSuspension) {
		t.Errorf("lifetime suspension ends %v", user.GetDateTime("suspended_until"))
	}
}

func TestBlocksEndFollowsBothWays(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	saveRecord(t, f.app, "follows", map[string]any{"follower": f.climber.Id, "followee": f.setterA.Id, "status": "accepted"})
	saveRecord(t, f.app, "follows", map[string]any{"follower": f.setterA.Id, "followee": f.climber.Id, "status": "accepted"})
	blocks := "/api/collections/blocks/records"

	call(t, f.app, f.climber, http.MethodPost, blocks, `{"blocker":"`+f.setterA.Id+`","blocked":"`+f.climber.Id+`"}`, http.StatusBadRequest)
	call(t, f.app, f.climber, http.MethodPost, blocks, `{"blocker":"`+f.climber.Id+`","blocked":"`+f.climber.Id+`"}`, http.StatusBadRequest)
	call(t, f.app, f.climber, http.MethodPost, blocks, `{"blocker":"`+f.climber.Id+`","blocked":"`+f.setterA.Id+`"}`, http.StatusOK)
	if total, _ := f.app.CountRecords("follows"); total != 0 {
		t.Errorf("%d follows survived the block", total)
	}
	follows := "/api/collections/follows/records"
	call(t, f.app, f.setterA, http.MethodPost, follows, `{"follower":"`+f.setterA.Id+`","followee":"`+f.climber.Id+`"}`, http.StatusForbidden)
	call(t, f.app, f.climber, http.MethodPost, follows, `{"follower":"`+f.climber.Id+`","followee":"`+f.setterA.Id+`"}`, http.StatusForbidden)
	call(t, f.app, f.setterA, http.MethodGet, "/api/climbers/"+f.climber.Id, "", http.StatusNotFound)
	call(t, f.app, f.setterA, http.MethodGet, "/api/collections/blocks/records", "", http.StatusOK, `"totalItems":0`)
}

func TestQuarantineExpires(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	old := saveRecord(t, f.app, "moderation_items", map[string]any{
		"gym": f.gymA.Id, "content_type": "rating", "content_id": "oldrating000001", "state": "hidden",
		"reviewed_at": types.NowDateTime().Add(-181 * 24 * time.Hour),
	})
	recent := saveRecord(t, f.app, "moderation_items", map[string]any{
		"gym": f.gymA.Id, "content_type": "rating", "content_id": "newrating000001", "state": "hidden",
		"reviewed_at": types.NowDateTime().Add(-24 * time.Hour),
	})
	pruneQuarantine(f.app)
	if _, err := f.app.FindRecordById("moderation_items", old.Id); err == nil {
		t.Error("expired quarantine was kept")
	}
	if _, err := f.app.FindRecordById("moderation_items", recent.Id); err != nil {
		t.Error("recent quarantine was pruned")
	}
}

func TestDecisionsCloseReports(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "rude"})
	newReport := func() *core.Record {
		return saveRecord(t, f.app, "reports", map[string]any{
			"content_type": "rating", "content_id": rating.Id, "content_url": "/", "reason": "harassment",
			"explanation": "Rude", "notifier_name": "N", "notifier_email": "n@example.com", "good_faith": true, "status": "open",
		})
	}
	first, second := newReport(), newReport()
	url := "/api/moderation/" + f.item(t, "rating", rating.Id).Id

	call(t, f.app, f.setterA, http.MethodPost, url, `{"action":"hide","reason":"  "}`, http.StatusBadRequest)
	call(t, f.app, f.setterA, http.MethodPost, url, `{"action":"approve"}`, http.StatusOK)
	for _, report := range []*core.Record{first, second} {
		stored, _ := f.app.FindRecordById("reports", report.Id)
		if stored.GetString("status") != "rejected" || stored.GetString("decision") != "content_kept" || stored.GetString("decided_by") != f.setterA.Id {
			t.Errorf("kept report = %s/%s by %s", stored.GetString("status"), stored.GetString("decision"), stored.GetString("decided_by"))
		}
	}

	third := newReport()
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("hide"), http.StatusOK)
	stored, _ := f.app.FindRecordById("reports", third.Id)
	if stored.GetString("status") != "actioned" || stored.GetString("decision_reason") != "spam" {
		t.Errorf("hidden report = %s, reason %q", stored.GetString("status"), stored.GetString("decision_reason"))
	}
}

func TestInboxContextAndSummary(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "spam"})
	saveRecord(t, f.app, "reports", map[string]any{
		"content_type": "rating", "content_id": rating.Id, "content_url": "/", "reason": "spam_fraud",
		"explanation": "Ads", "notifier_name": "Nora", "notifier_email": "n@example.com", "good_faith": true, "status": "open",
	})
	item := f.item(t, "rating", rating.Id)
	call(t, f.app, f.setterA, http.MethodGet, recordURL("moderation_items", item.Id), "", http.StatusOK,
		`"route":{"id":"`+f.route.Id+`","name":"Crimp"`, `"reason":"spam_fraud","explanation":"","notifier_name":""`, `"history":{"items":1,"hidden":0}`)
	call(t, f.app, f.adminA, http.MethodGet, recordURL("moderation_items", item.Id), "", http.StatusOK,
		`"explanation":"Ads","notifier_name":"Nora"`)
	call(t, f.app, f.setterA, http.MethodGet, "/api/moderation/summary?gym="+f.gymA.Id, "", http.StatusOK, `"decide":1`)
	call(t, f.app, f.setterB, http.MethodGet, "/api/moderation/summary?gym="+f.gymA.Id, "", http.StatusForbidden)
	call(t, f.app, f.setterA, http.MethodGet, "/api/moderation/summary", "", http.StatusForbidden)
	call(t, f.app, f.operator, http.MethodGet, "/api/moderation/summary", "", http.StatusOK, `"legal_reports":1`, `"open":1`)
}

func TestHidingAllContentOfAnAuthor(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	first := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "buy now"})
	second := saveRecord(t, f.app, "beta_videos", map[string]any{"user": f.climber.Id, "route": f.route.Id, "url": "https://youtube.com/shorts/9"})
	hide := "/api/moderation/authors/" + f.climber.Id + "/hide"

	call(t, f.app, f.adminA, http.MethodPost, hide, `{"reason":"spam"}`, http.StatusForbidden)
	call(t, f.app, f.operator, http.MethodPost, hide, `{"reason":""}`, http.StatusBadRequest)
	call(t, f.app, f.operator, http.MethodPost, hide, `{"reason":"spam"}`, http.StatusOK, `"hidden":2`)
	for _, record := range []*core.Record{first, second} {
		if _, err := f.app.FindRecordById(record.Collection().Name, record.Id); err == nil {
			t.Errorf("%s %s is still public", record.Collection().Name, record.Id)
		}
	}
}

func TestReportedRoutesAreArchivedOnHide(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	saveRecord(t, f.app, "reports", map[string]any{
		"content_type": "route", "content_id": f.route.Id, "content_url": "/", "reason": "ip_infringement",
		"explanation": "Copied", "notifier_name": "N", "notifier_email": "n@example.com", "good_faith": true, "status": "open",
	})
	url := "/api/moderation/" + f.item(t, "route", f.route.Id).Id
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("hide"), http.StatusOK)
	if route, _ := f.app.FindRecordById("routes", f.route.Id); !route.GetBool("archived") {
		t.Error("hidden route stays on the wall")
	}
	call(t, f.app, f.setterA, http.MethodPost, url, moderationAction("restore"), http.StatusOK)
	if route, _ := f.app.FindRecordById("routes", f.route.Id); route.GetBool("archived") {
		t.Error("restored route stays archived")
	}
}

func TestAnonymousReviewersStayAnonymousToGymStaff(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	f.climber.Set("reviews_anonymous", true)
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "meh"})
	url := recordURL("moderation_items", f.item(t, "rating", rating.Id).Id)

	staffView := httpBody(t, f.app, f.setterA, url)
	if strings.Contains(staffView, f.climber.Id) {
		t.Errorf("gym staff learn the anonymous author: %s", staffView)
	}
	call(t, f.app, f.operator, http.MethodGet, url, "", http.StatusOK, `"author":{"id":"`+f.climber.Id+`"`)
}

func TestOpeningACaseForOlderContent(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "old"})
	item := f.item(t, "rating", rating.Id)
	if err := f.app.Delete(item); err != nil {
		t.Fatal(err)
	}
	body := `{"content_type":"rating","content_id":"` + rating.Id + `"}`

	call(t, f.app, f.setterB, http.MethodPost, "/api/moderation/cases", body, http.StatusNotFound)
	call(t, f.app, f.climber, http.MethodPost, "/api/moderation/cases", body, http.StatusNotFound)
	call(t, f.app, f.setterA, http.MethodPost, "/api/moderation/cases", `{"content_type":"seasons","content_id":"x"}`, http.StatusBadRequest)
	call(t, f.app, f.setterA, http.MethodPost, "/api/moderation/cases", body, http.StatusOK, `"state":"unreviewed"`)
	opened := f.item(t, "rating", rating.Id)
	call(t, f.app, f.operator, http.MethodPost, "/api/moderation/cases", body, http.StatusOK, `"id":"`+opened.Id+`"`)
}

func TestHeldUploadsAreValidated(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	f.gymA.Set("premoderate_betas", true)
	if err := f.app.Save(f.gymA); err != nil {
		t.Fatal(err)
	}
	upload := func(name, mime string, content []byte) *httptest.ResponseRecorder {
		var buffer bytes.Buffer
		form := multipart.NewWriter(&buffer)
		_ = form.WriteField("user", f.climber.Id)
		_ = form.WriteField("route", f.route.Id)
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", `form-data; name="file"; filename="`+name+`"`)
		header.Set("Content-Type", mime)
		part, _ := form.CreatePart(header)
		_, _ = part.Write(content)
		_ = form.Close()
		request := httptest.NewRequest(http.MethodPost, "/api/collections/beta_videos/records", &buffer)
		request.Header.Set("Content-Type", form.FormDataContentType())
		token, _ := f.climber.NewAuthToken()
		request.Header.Set("Authorization", token)
		recorder := httptest.NewRecorder()
		handlerOf(t, f.app).ServeHTTP(recorder, request)
		return recorder
	}

	if res := upload("page.html", "text/html", []byte("<script>alert(1)</script>")); res.Code != http.StatusBadRequest {
		t.Errorf("html upload = %d: %s", res.Code, res.Body.String())
	}
	if total, _ := f.app.CountRecords("moderation_items", dbx.HashExp{"state": "pending"}); total != 0 {
		t.Errorf("an invalid upload was held (%d items)", total)
	}
	if res := upload("beta.mp4", "video/mp4", []byte("\x00\x00\x00\x18ftypmp42")); res.Code != http.StatusAccepted {
		t.Errorf("mp4 upload = %d: %s", res.Code, res.Body.String())
	}
}

func TestHidingAllContentInformsTheAuthor(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "buy"})
	saveRecord(t, f.app, "beta_videos", map[string]any{"user": f.climber.Id, "route": f.route.Id, "url": "https://youtube.com/shorts/7"})
	call(t, f.app, f.operator, http.MethodPost, "/api/moderation/authors/"+f.climber.Id+"/hide", `{"reason":"spam"}`, http.StatusOK)
	if total, _ := f.app.CountRecords("notifications", dbx.HashExp{"user": f.climber.Id, "type": "content_hidden"}); total != 1 {
		t.Errorf("author got %d hide notices, want one for the whole batch", total)
	}
}

func httpBody(t *testing.T, app *tests.TestApp, auth *core.Record, url string) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, url, nil)
	token, err := auth.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", token)
	recorder := httptest.NewRecorder()
	handlerOf(t, app).ServeHTTP(recorder, request)
	return recorder.Body.String()
}

func TestLongReviewsStillGetACase(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": strings.Repeat("<&", 2500)})
	item := f.item(t, "rating", rating.Id)
	var snapshot map[string]any
	if err := item.UnmarshalJSONField("snapshot", &snapshot); err != nil || snapshot["user"] != nil {
		t.Errorf("snapshot keeps the author or fails: %v %v", snapshot["user"], err)
	}
	call(t, f.app, f.setterA, http.MethodPost, "/api/moderation/"+item.Id, moderationAction("hide"), http.StatusOK)
	call(t, f.app, f.setterA, http.MethodPost, "/api/moderation/"+item.Id, moderationAction("restore"), http.StatusOK)
	if restored, err := f.app.FindRecordById("ratings", rating.Id); err != nil || restored.GetString("user") != f.climber.Id {
		t.Errorf("restored review lost its author: %v", err)
	}
}

func TestEditingHiddenContentReopensTheCase(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	f.climber.Set("firstname", "Rude")
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	item := f.item(t, "profile", f.climber.Id)
	call(t, f.app, f.operator, http.MethodPost, "/api/moderation/"+item.Id, moderationAction("hide"), http.StatusOK)
	if state := f.item(t, "profile", f.climber.Id).GetString("state"); state != "hidden" {
		t.Fatalf("hiding reopened the case: %s", state)
	}
	user, _ := f.app.FindRecordById("users", f.climber.Id)
	user.Set("firstname", "Ruder")
	if err := f.app.Save(user); err != nil {
		t.Fatal(err)
	}
	reopened := f.item(t, "profile", f.climber.Id)
	if reopened.GetString("state") != "unreviewed" || reopened.GetString("hidden_by") != "" {
		t.Errorf("edited hidden profile = %s/%s, want a fresh case", reopened.GetString("state"), reopened.GetString("hidden_by"))
	}
}

func TestReportsAlwaysGetADecision(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	reports := "/api/collections/reports/records"
	body := func(contentType, id string) string {
		return `{"content_type":"` + contentType + `","content_id":"` + id + `","reason":"spam_fraud","explanation":"x","notifier_name":"N","notifier_email":"n@example.com","good_faith":true}`
	}
	call(t, f.app, f.setterB, http.MethodPost, reports, body("rating", "missing00000000"), http.StatusBadRequest, "does not exist")

	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "gone soon"})
	call(t, f.app, f.setterB, http.MethodPost, reports, body("rating", rating.Id), http.StatusOK)
	call(t, f.app, f.climber, http.MethodDelete, recordURL("ratings", rating.Id), "", http.StatusNoContent)
	if open, _ := f.app.CountRecords("reports", dbx.HashExp{"content_id": rating.Id, "status": "open"}); open != 0 {
		t.Errorf("%d reports stayed open after the author deleted the review", open)
	}

	f.climber.Set("firstname", "Rude")
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	call(t, f.app, f.operator, http.MethodPost, "/api/moderation/"+f.item(t, "profile", f.climber.Id).Id, moderationAction("hide"), http.StatusOK)
	call(t, f.app, f.setterB, http.MethodPost, reports, body("profile", f.climber.Id), http.StatusOK)
	if open, _ := f.app.CountRecords("reports", dbx.HashExp{"content_id": f.climber.Id, "status": "open"}); open != 0 {
		t.Errorf("a report on hidden content stayed open")
	}
}

func TestDecidingAReportInformsTheAuthor(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	rating := saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "rude"})
	report := saveRecord(t, f.app, "reports", map[string]any{
		"content_type": "rating", "content_id": rating.Id, "content_url": "/", "reason": "harassment",
		"explanation": "Rude", "notifier_name": "N", "notifier_email": "n@example.com", "good_faith": true, "status": "open",
	})
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("reports", report.Id), `{"status":"actioned","decision":"content_removed","decision_reason":"rude"}`, http.StatusOK)
	if total, _ := f.app.CountRecords("notifications", dbx.HashExp{"user": f.climber.Id, "type": "content_hidden"}); total != 1 {
		t.Errorf("author got %d hide notices, want 1", total)
	}
}

func TestOnlyThePlatformFiltersCasesByAuthor(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	saveRecord(t, f.app, "ratings", map[string]any{"route_id": f.route.Id, "user": f.climber.Id, "rating": 1, "comment": "x"})
	byAuthor := "/api/collections/moderation_items/records?filter=" + url.QueryEscape(`author="`+f.climber.Id+`"`)
	call(t, f.app, f.setterA, http.MethodGet, byAuthor, "", http.StatusForbidden)
	call(t, f.app, f.setterA, http.MethodGet, "/api/collections/moderation_items/records?sort=author", "", http.StatusForbidden)
	call(t, f.app, f.operator, http.MethodGet, byAuthor, "", http.StatusOK, `"totalItems":2`)
}

func TestConcurrentDecisionsApplyOnce(t *testing.T) {
	f := newModerationFixture(t)
	defer f.app.Cleanup()

	f.climber.Set("firstname", "Rude")
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	item := f.item(t, "profile", f.climber.Id)
	handler := handlerOf(t, f.app)
	token, err := f.operator.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	codes := make(chan int, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			request := httptest.NewRequest(http.MethodPost, "/api/moderation/"+item.Id, strings.NewReader(moderationAction("hide")))
			request.Header.Set("content-type", "application/json")
			request.Header.Set("Authorization", token)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			codes <- recorder.Code
		}()
	}
	wait.Wait()
	close(codes)
	results := []int{}
	for code := range codes {
		results = append(results, code)
	}
	slices.Sort(results)
	if !slices.Equal(results, []int{http.StatusOK, http.StatusForbidden}) {
		t.Fatalf("concurrent hides answered %v, want one success and one refusal", results)
	}

	hidden := f.item(t, "profile", f.climber.Id)
	var snapshot map[string]any
	if err := hidden.UnmarshalJSONField("snapshot", &snapshot); err != nil || snapshot["firstname"] != "Rude" {
		t.Errorf("the losing request overwrote the quarantine: %v (%v)", snapshot["firstname"], err)
	}
	if total, _ := f.app.CountRecords("notifications", dbx.HashExp{"user": f.climber.Id, "type": "content_hidden"}); total != 1 {
		t.Errorf("author got %d hide notices, want 1", total)
	}
}
