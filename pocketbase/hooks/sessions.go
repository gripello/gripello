package hooks

import (
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/spf13/cast"
)

const (
	sessionClaim        = "sid"
	sessionTouchEvery   = 10 * time.Minute
	passkeyLoginFlag    = "gripelloPasskeyLogin"
	realtimeSessionKey  = "gripelloSession"
	sessionUserAgentMax = 300
)

func registerSessions(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.Bind(&hook.Handler[*core.RequestEvent]{
			Id:       "gripelloSessions",
			Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 1,
			Func:     checkSession,
		})
		se.Router.POST("/api/account/sessions/sign-out-others", signOutOtherSessions).Bind(apis.RequireAuth("users"))
		return se.Next()
	})

	app.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		passkey := e.Get(passkeyLoginFlag) == true
		if e.AuthMethod == "" && !passkey {
			return refreshSession(e)
		}
		method := e.AuthMethod
		if passkey {
			method = mfaMethodPasskey
			e.AuthMethod = ""
		}
		session, err := startSession(e, method)
		if err != nil {
			return err
		}
		if err := e.Next(); err != nil {
			_ = e.App.Delete(session)
			return err
		}
		clearLoginFailures(e.App, e.Record.Id)
		if method != core.MFAMethodPassword {
			writeAuthEvent(e.RequestEvent, nil, e.Record, "login", method)
		}
		return nil
	})

	app.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		if e.Auth != nil && e.Auth.Collection().Name == "users" {
			e.Client.Set(realtimeSessionKey, tokenSessionID(e.RequestEvent, e.Auth.Id))
		}
		return e.Next()
	})

	app.OnRecordAfterDeleteSuccess("sessions").BindFunc(func(e *core.RecordEvent) error {
		dropRealtimeAuth(e.App, e.Record.GetString("user"), func(sid string) bool { return sid == e.Record.Id })
		return e.Next()
	})

	app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		rotated := e.Record.Original().TokenKey() != e.Record.TokenKey()
		if err := e.Next(); err != nil || !rotated {
			return err
		}
		_, err := e.App.DB().NewQuery("DELETE FROM sessions WHERE user = {:user}").Bind(dbx.Params{"user": e.Record.Id}).Execute()
		return err
	})

	app.Cron().MustAdd("sessionCleanup", "23 4 * * *", func() {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return
		}
		if _, err := pruneRows(app, "DELETE FROM sessions WHERE last_seen < {:cutoff}", dbx.Params{"cutoff": cutoff(users.AuthToken.DurationTime())}); err != nil {
			app.Logger().Error("sessions: cleanup failed", "error", err)
		}
	})
}

func requestClaims(e *core.RequestEvent, userID string) jwt.MapClaims {
	token := e.Request.Header.Get("Authorization")
	if len(token) > 7 && strings.EqualFold(token[:7], "Bearer ") {
		token = token[7:]
	}
	claims, err := security.ParseUnverifiedJWT(token)
	if err != nil || cast.ToString(claims[core.TokenClaimId]) != userID {
		return jwt.MapClaims{}
	}
	return claims
}

func tokenSessionID(e *core.RequestEvent, userID string) string {
	return cast.ToString(requestClaims(e, userID)[sessionClaim])
}

func checkSession(e *core.RequestEvent) error {
	if e.Auth == nil || e.Auth.Collection().Name != "users" {
		return e.Next()
	}
	sid := tokenSessionID(e, e.Auth.Id)
	if sid == "" {
		return e.Next()
	}
	session, err := e.App.FindRecordById("sessions", sid)
	if err != nil || session.GetString("user") != e.Auth.Id {
		e.Auth = nil
		return e.Next()
	}
	if time.Since(session.GetDateTime("last_seen").Time()) > sessionTouchEvery {
		session.Set("last_seen", time.Now())
		session.Set("ip", displayIP(e.RealIP()))
		if err := e.App.Save(session); err != nil {
			e.App.Logger().Warn("sessions: failed to touch", "error", err)
		}
	}
	return e.Next()
}

func startSession(e *core.RecordAuthRequestEvent, method string) (*core.Record, error) {
	collection, err := e.App.FindCachedCollectionByNameOrId("sessions")
	if err != nil {
		return nil, err
	}
	session := core.NewRecord(collection)
	session.Set("user", e.Record.Id)
	session.Set("method", method)
	session.Set("user_agent", truncateRunes(e.Request.UserAgent(), sessionUserAgentMax))
	session.Set("ip", displayIP(e.RealIP()))
	session.Set("last_seen", time.Now())
	if err := e.App.Save(session); err != nil {
		return nil, err
	}
	token, err := sessionToken(e.Record, session.Id)
	if err != nil {
		return nil, err
	}
	e.Token = token
	return session, nil
}

func refreshSession(e *core.RecordAuthRequestEvent) error {
	claims := requestClaims(e.RequestEvent, e.Record.Id)
	if e.Auth == nil || e.Auth.Id != e.Record.Id || !cast.ToBool(claims[core.TokenClaimRefreshable]) {
		return e.Next()
	}
	sid := cast.ToString(claims[sessionClaim])
	if sid == "" {
		session, err := startSession(e, "")
		if err != nil {
			return err
		}
		if err := e.Next(); err != nil {
			_ = e.App.Delete(session)
			return err
		}
		return nil
	}
	token, err := sessionToken(e.Record, sid)
	if err != nil {
		return err
	}
	e.Token = token
	return e.Next()
}

func sessionToken(user *core.Record, sid string) (string, error) {
	claims := jwt.MapClaims{
		core.TokenClaimType:         core.TokenTypeAuth,
		core.TokenClaimId:           user.Id,
		core.TokenClaimCollectionId: user.Collection().Id,
		core.TokenClaimRefreshable:  true,
		sessionClaim:                sid,
	}
	return security.NewJWT(claims, user.TokenKey()+user.Collection().AuthToken.Secret, user.Collection().AuthToken.DurationTime())
}

func signOutOtherSessions(e *core.RequestEvent) error {
	_, err := e.App.DB().NewQuery("DELETE FROM sessions WHERE user = {:user} AND id != {:current}").
		Bind(dbx.Params{"user": e.Auth.Id, "current": tokenSessionID(e, e.Auth.Id)}).Execute()
	if err != nil {
		return e.InternalServerError("", err)
	}
	current := tokenSessionID(e, e.Auth.Id)
	dropRealtimeAuth(e.App, e.Auth.Id, func(sid string) bool { return sid != current })
	writeAuthEvent(e, nil, e.Auth, "sessions_revoked", "")
	return e.NoContent(http.StatusNoContent)
}

// Like PocketBase on a password change: the connection stays open but unauthenticated, so the next subscribe isn't refused.
func dropRealtimeAuth(app core.App, userID string, revoked func(sid string) bool) {
	for _, client := range app.SubscriptionsBroker().Clients() {
		auth, _ := client.Get(apis.RealtimeClientAuthKey).(*core.Record)
		sid, _ := client.Get(realtimeSessionKey).(string)
		if auth != nil && auth.Id == userID && sid != "" && revoked(sid) {
			client.Unset(apis.RealtimeClientAuthKey)
		}
	}
}

func displayIP(raw string) string {
	if ip := net.ParseIP(raw); ip != nil {
		return ip.String()
	}
	return raw
}
