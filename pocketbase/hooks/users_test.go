package hooks

import (
	"net/http"
	"testing"
)

func TestPlatformAdminManagesUsers(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	operator := platformAdmin(t, f.app)
	climber := recordURL("users", f.climber.Id)

	call(t, f.app, operator, http.MethodGet, "/api/collections/users/records?filter=platform_admin=false", "", http.StatusOK, f.climber.Id)
	call(t, f.app, operator, http.MethodPatch, climber, `{"name":"Renamed","verified":true,"email":"renamed@example.com"}`, http.StatusOK, "Renamed", "renamed@example.com")
	call(t, f.app, operator, http.MethodPatch, climber, `{"username":"renamed_climber","avatar":null}`, http.StatusOK, "renamed_climber")
	call(t, f.app, operator, http.MethodPatch, climber, `{"platform_admin":true}`, http.StatusNotFound)
	call(t, f.app, operator, http.MethodPatch, climber, `{"notification_prefs":{"push":{"tasks":false}}}`, http.StatusNotFound)
	call(t, f.app, f.adminA, http.MethodPatch, recordURL("users", f.setterA.Id), `{"name":"x"}`, http.StatusNotFound)
	call(t, f.app, f.adminA, http.MethodDelete, climber, "", http.StatusNotFound)

	call(t, f.app, operator, http.MethodDelete, climber, "", http.StatusNoContent)
	if _, err := f.app.FindRecordById("users", f.climber.Id); err == nil {
		t.Error("user still exists after the platform admin deleted it")
	}
}

func TestPlatformAdminCannotTouchOtherPlatformAdmins(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	operator := platformAdmin(t, f.app)
	peer := saveUser(t, f.app, "peer-operator@example.com")
	peer.Set("platform_admin", true)
	if err := f.app.Save(peer); err != nil {
		t.Fatal(err)
	}

	call(t, f.app, operator, http.MethodPatch, recordURL("users", peer.Id), `{"email":"taken@example.com"}`, http.StatusForbidden)
	call(t, f.app, operator, http.MethodDelete, recordURL("users", peer.Id), "", http.StatusForbidden)
	call(t, f.app, operator, http.MethodPatch, recordURL("users", operator.Id), `{"name":"Me"}`, http.StatusOK)
}

func TestDeletingTheLastGymAdminIsRejected(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	operator := platformAdmin(t, f.app)

	call(t, f.app, operator, http.MethodDelete, recordURL("users", f.adminA.Id), "", http.StatusBadRequest, "at least one admin")
	saveRecord(t, f.app, "memberships", map[string]any{"user": f.climber.Id, "gym": f.gymA.Id, "role": f.adminRoleA.Id})
	call(t, f.app, operator, http.MethodDelete, recordURL("users", f.adminA.Id), "", http.StatusNoContent)
}

func TestPlatformAdminFindsUsersByHiddenEmail(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	operator := platformAdmin(t, f.app)
	f.climber.Set("emailVisibility", false)
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	email := f.climber.GetString("email")

	call(t, f.app, operator, http.MethodGet, "/api/platform/users/email-matches?q="+email, "", http.StatusOK, f.climber.Id)
	call(t, f.app, f.adminA, http.MethodGet, "/api/platform/users/email-matches?q="+email, "", http.StatusForbidden)
}
