package gyms

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
	"gripello/internal/platform/testapp"
)

var onboardingLink = regexp.MustCompile(`/auth/gym/([0-9a-f]{60})`)

func (f *fixture) onboardingToken(email string) string {
	f.t.Helper()
	f.call(f.operator, "POST", "/platform/gym-onboardings", `{"email":"`+email+`"}`, http.StatusAccepted)
	mails := testapp.Mails(f.app)
	match := onboardingLink.FindStringSubmatch(mails[len(mails)-1].Text)
	if match == nil {
		f.t.Fatalf("no onboarding link in %q", mails[len(mails)-1].Text)
	}
	return match[1]
}

func TestOnlyPlatformAdminsSendOnboardingLinks(t *testing.T) {
	f := newFixture(t)
	someone := f.user("someone")
	f.call(someone, "POST", "/platform/gym-onboardings", `{"email":"new@gym.test"}`, http.StatusForbidden)
	f.call("", "POST", "/platform/gym-onboardings", `{"email":"new@gym.test"}`, http.StatusUnauthorized)
	f.call(someone, "GET", "/platform/gym-onboardings", "", http.StatusForbidden)
	f.call(f.operator, "POST", "/platform/gym-onboardings", `{"email":"not-an-email"}`, http.StatusBadRequest, "validation_is_email")
}

func TestRedeemOnboardingCreatesATrialGymWithAnAdminInvite(t *testing.T) {
	f := newFixture(t)
	first := f.onboardingToken("Owner@Gym.test")
	token := f.onboardingToken("owner@gym.test")
	f.call("", "GET", "/gym-onboardings/"+first, "", http.StatusNotFound)
	f.call(f.operator, "GET", "/platform/gym-onboardings", "", http.StatusOK, `"email":"owner@gym.test"`)
	f.call("", "GET", "/gym-onboardings/"+token, "", http.StatusOK, `"owner@gym.test"`)

	f.createGym("taken-gym", "Taken", true)
	f.call("", "POST", "/gym-onboardings/"+token+"/redeem", `{"name":"New Gym","slug":"taken-gym"}`, http.StatusBadRequest, "validation_slug_used")
	f.call("", "POST", "/gym-onboardings/"+token+"/redeem", `{"name":"New Gym","slug":"api"}`, http.StatusBadRequest)
	res := f.call("", "POST", "/gym-onboardings/"+token+"/redeem", `{"name":"New Gym","slug":"new-gym","features":{"beta_links":true}}`, http.StatusCreated, `"gym":"new-gym"`).json(t)

	var trialDays, features int
	f.scalar(`SELECT round(extract(epoch FROM trial_ends_at - now()) / 86400) FROM gyms WHERE slug = 'new-gym' AND active`, &trialDays)
	f.scalar(`SELECT count(*) FROM gyms g, jsonb_object_keys(g.features) WHERE slug = 'new-gym'`, &features)
	if trialDays != 30 || features != 0 {
		t.Errorf("trial of %d days, %d features; want 30 days and none", trialDays, features)
	}
	var role string
	f.scalar(`SELECT r.name FROM invites i JOIN roles r ON r.id = i.role JOIN gyms g ON g.id = i.gym
		WHERE g.slug = 'new-gym' AND i.email = 'owner@gym.test' AND i.token_hash = $1`, &role, ids.Hash(res["invite"].(string)))
	if role != "admin" {
		t.Errorf("invite role %q, want admin", role)
	}
	f.call("", "POST", "/gym-onboardings/"+token+"/redeem", `{"name":"Again","slug":"again-gym"}`, http.StatusNotFound)
}

func TestExpiredTrialLeavesStaffReadOnly(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("trial-gym", "Trial", true)
	admin := f.user("trial-admin")
	f.member(admin, gym, "admin")
	perms := tenancy.New(f.app.DB)
	ctx := context.Background()

	f.call(admin, "PATCH", "/gyms/"+gym, `{"trial_ends_at":"2020-01-01T00:00:00Z"}`, http.StatusForbidden, "trial")
	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"trial_ends_at":"2020-01-01T00:00:00Z"}`, http.StatusOK)
	if perms.Can(ctx, admin, gym, "manage_routes") || !perms.Can(ctx, admin, gym, "view_analytics") {
		t.Error("an expired trial must keep only view_analytics")
	}
	f.call(admin, "PATCH", "/gyms/"+gym, `{"name":"Renamed"}`, http.StatusForbidden)

	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"trial_ends_at":null}`, http.StatusOK, `"trial_ends_at":null`)
	if !perms.Can(ctx, admin, gym, "manage_routes") {
		t.Error("converting the gym must restore staff permissions")
	}
}

func TestTrialRemindersGoOutOnce(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("remind-gym", "Remind", true)
	admin := f.user("remind-admin")
	f.member(admin, gym, "admin")
	m := &module{app: f.app, db: f.app.DB}
	ctx := context.Background()
	sent := func() int { return len(testapp.Mails(f.app)) }

	f.exec(`UPDATE gyms SET trial_ends_at = now() + interval '20 days' WHERE id = $1`, gym)
	before := sent()
	if err := m.remindTrials(ctx); err != nil || sent() != before {
		t.Fatalf("no reminder before the last week: %v, %d mails", err, sent()-before)
	}
	f.exec(`UPDATE gyms SET trial_ends_at = now() + interval '5 days' WHERE id = $1`, gym)
	m.remindTrials(ctx)
	m.remindTrials(ctx)
	if sent() != before+1 || !strings.Contains(testapp.Mails(f.app)[sent()-1].Text, "Remind") {
		t.Fatalf("want one ending reminder, got %d", sent()-before)
	}
	f.exec(`UPDATE gyms SET trial_ends_at = now() - interval '1 hour' WHERE id = $1`, gym)
	m.remindTrials(ctx)
	m.remindTrials(ctx)
	if sent() != before+2 {
		t.Fatalf("want one ended notice, got %d mails", sent()-before)
	}
}

func TestAdminInviteLastsAsLongAsTheTrial(t *testing.T) {
	f := newFixture(t)
	token := f.onboardingToken("long@gym.test")
	f.call("", "POST", "/gym-onboardings/"+token+"/redeem", `{"name":"Long","slug":"long-gym"}`, http.StatusCreated)
	var same bool
	f.scalar(`SELECT i.expires_at = g.trial_ends_at FROM invites i JOIN gyms g ON g.id = i.gym WHERE g.slug = 'long-gym'`, &same)
	if !same {
		t.Error("the admin invite must stay valid until the trial ends")
	}
}

func TestUnchangedTrialEndKeepsTheReminderState(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("notice-gym", "Notice", true)
	admin := f.user("notice-admin")
	f.member(admin, gym, "admin")
	f.exec(`UPDATE gyms SET trial_ends_at = '2030-01-01T00:00:00Z', trial_notice = 1 WHERE id = $1`, gym)

	f.call(admin, "PATCH", "/gyms/"+gym, `{"name":"Notice","trial_ends_at":"2030-01-01T00:00:00Z"}`, http.StatusOK)
	var notice int
	f.scalar(`SELECT trial_notice FROM gyms WHERE id = $1`, &notice, gym)
	if notice != 1 {
		t.Errorf("trial_notice = %d after an unchanged trial end, want 1", notice)
	}
	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"trial_ends_at":"2030-02-01T00:00:00Z"}`, http.StatusOK)
	f.scalar(`SELECT trial_notice FROM gyms WHERE id = $1`, &notice, gym)
	if notice != 0 {
		t.Errorf("trial_notice = %d after extending, want 0", notice)
	}
}

func TestOnlyMembersSeeTheTrialEnd(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("secret-trial", "Secret", true)
	admin := f.user("secret-admin")
	f.member(admin, gym, "admin")
	stranger := f.user("secret-stranger")
	f.exec(`UPDATE gyms SET trial_ends_at = '2030-01-01T00:00:00Z' WHERE id = $1`, gym)

	for _, viewer := range []string{"", stranger} {
		for _, path := range []string{"/gyms/secret-trial", "/gyms"} {
			if body := f.call(viewer, "GET", path, "", http.StatusOK).Body; strings.Contains(body, "trial_") {
				t.Errorf("%s for %q exposes trial fields: %s", path, viewer, body)
			}
		}
	}
	f.call(admin, "GET", "/gyms/secret-trial", "", http.StatusOK, `"trial_ends_at":"2030-01-01`)
	f.call(f.operator, "GET", "/gyms?all=1", "", http.StatusOK, `"trial_ends_at":"2030-01-01`)

	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"name":"Secret 2"}`, http.StatusOK)
	var published string
	f.scalar(`SELECT payload::text FROM events WHERE kind = 'gym.updated' AND topic = 'gym:' || $1 ORDER BY id DESC LIMIT 1`, &published, gym)
	if strings.Contains(published, "trial_") {
		t.Errorf("gym.updated carries trial fields: %s", published)
	}
}

func TestTrialChangesReachOnlyMembersAndPlatformAdmins(t *testing.T) {
	f := newFixture(t)
	gym := f.createGym("live-trial", "Live", true)
	admin := f.user("live-admin")
	f.member(admin, gym, "admin")
	f.exec(`UPDATE gyms SET trial_ends_at = now() + interval '20 days' WHERE id = $1`, gym)
	trialEvents := func() int {
		var n int
		f.scalar(`SELECT count(*) FROM events WHERE kind = 'gym.trial_changed' AND topic = 'gym:' || $1
			AND audience->'users' = jsonb_build_array($2::text) AND (audience->>'platform_admins')::boolean
			AND audience->>'public' IS NULL`, &n, gym, admin)
		return n
	}

	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"name":"Live 2"}`, http.StatusOK)
	if n := trialEvents(); n != 0 {
		t.Fatalf("%d trial events without a trial change", n)
	}
	f.call(f.operator, "PATCH", "/gyms/"+gym, `{"trial_ends_at":null}`, http.StatusOK)
	if n := trialEvents(); n != 1 {
		t.Fatalf("%d trial events after converting, want 1", n)
	}

	f.exec(`UPDATE gyms SET trial_ends_at = now() - interval '1 minute', trial_notice = 1 WHERE id = $1`, gym)
	m := &module{app: f.app, db: f.app.DB}
	if err := m.remindTrials(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := trialEvents(); n != 2 {
		t.Fatalf("%d trial events after the trial ran out, want 2", n)
	}
}
