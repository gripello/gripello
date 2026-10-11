package authn

import (
	"context"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/events"
)

const (
	TopicAudit          = "audit"
	TopicSessionRevoked = "session.revoked"
	KindSessionRevoked  = "session.revoked"
	KindLogin           = "auth.login"
	KindLoginFailed     = "auth.failed"
)

// AuthEvent feeds the audit log; Action is the audit action (login, login_failed, password_reset, mfa_enabled…).
type AuthEvent struct {
	Action string `json:"action"`
	User   string `json:"user,omitempty"`
	Label  string `json:"label"`
	Method string `json:"method,omitempty"`
	IP     string `json:"ip"`
}

type SessionRevoked struct {
	Session string `json:"session"`
	User    string `json:"user"`
}

func authEventKind(action string) string {
	switch action {
	case "login":
		return KindLogin
	case "login_failed":
		return KindLoginFailed
	}
	return "auth." + action
}

func publishAuthEvent(ctx context.Context, tx pgx.Tx, e AuthEvent) error {
	return events.Publish(ctx, tx, TopicAudit, authEventKind(e.Action), e, events.Audience{})
}

func publishSessionRevoked(ctx context.Context, tx pgx.Tx, userID string, sessionIDs []string) error {
	for _, id := range sessionIDs {
		if err := events.Publish(ctx, tx, TopicSessionRevoked, KindSessionRevoked, SessionRevoked{Session: id, User: userID}, events.Audience{Users: []string{userID}}); err != nil {
			return err
		}
	}
	return nil
}

// Server-only, so every replica drops cached principals of the user even when no session row was deleted (the kept session, legacy tokens).
func publishTokenRotated(ctx context.Context, tx pgx.Tx, userID string) error {
	return events.Publish(ctx, tx, "user:"+userID, "user.token_rotated", map[string]string{"user": userID}, events.Audience{})
}
