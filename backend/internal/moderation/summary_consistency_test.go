package moderation

import (
	"net/http"
	"testing"

	"gripello/internal/platform/events"
	"gripello/internal/platform/ids"
)

func (f *fixture) caseTotal(user, query string) int {
	f.t.Helper()
	return int(f.call(user, "GET", "/moderation/cases?total=true&limit=1&"+query, "", http.StatusOK)["total"].(float64))
}

func (f *fixture) summaryOf(user, query string) map[string]any {
	f.t.Helper()
	return f.call(user, "GET", "/moderation/summary"+query, "", http.StatusOK)
}

func (f *fixture) expectSummaryMatchesInbox(step string) {
	f.t.Helper()
	gym := f.summaryOf("setterA", "?gym="+f.gymA)
	for field, state := range map[string]string{"decide": "unreviewed", "waiting": "pending", "hidden": "hidden"} {
		if listed := f.caseTotal("setterA", "gym=alpha&state="+state); int(gym[field].(float64)) != listed {
			f.t.Errorf("%s: gym summary %s = %v, inbox lists %d", step, field, gym[field], listed)
		}
	}
	platform := f.summaryOf("operator", "")
	if listed := f.caseTotal("operator", "queue=platform&state=unreviewed"); int(platform["decide"].(float64)) != listed {
		f.t.Errorf("%s: platform summary decide = %v, inbox lists %d", step, platform["decide"], listed)
	}
}

func TestModerationSummaryMatchesTheInboxThroughDecisions(t *testing.T) {
	f := newFixture(t)
	f.expectSummaryMatchesInbox("empty")

	quiet := f.rating("climber", "fine")
	reported := f.rating("climber", "rude")
	f.item("rating", quiet)
	f.report("rating", reported, "harassment")
	f.expectSummaryMatchesInbox("reported")

	reportedCase := "/moderation/" + f.item("rating", reported).ID
	f.call("setterA", "POST", reportedCase, action("hide"), http.StatusOK)
	f.expectSummaryMatchesInbox("hidden")

	f.call("setterA", "POST", reportedCase, `{"action":"restore"}`, http.StatusOK)
	f.expectSummaryMatchesInbox("restored")

	f.report("rating", reported, "spam_fraud")
	f.expectSummaryMatchesInbox("reported again")

	video := ids.New()
	f.publish("beta.pending", "beta.pending", map[string]string{"id": video, "gym": f.gymA, "route": f.route, "user": f.users["climber"], "url": "https://youtube.com/shorts/3"}, events.Audience{})
	pendingCase := "/moderation/" + f.item("beta_video", video).ID
	f.expectSummaryMatchesInbox("upload waiting")

	f.call("setterA", "POST", pendingCase, action("reject"), http.StatusOK)
	f.call("setterA", "POST", "/moderation/"+f.item("rating", quiet).ID, `{"action":"approve"}`, http.StatusOK)
	f.call("operator", "POST", reportedCase, `{"action":"approve"}`, http.StatusOK)
	f.expectSummaryMatchesInbox("decided")
}
