package authn

import (
	"net/http"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
)

func (m *module) listSessions(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	items, err := listSessions(r.Context(), m.db, p.UserID, p.SessionID)
	if err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": items}, nil)
}

func (m *module) revokeSession(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	var found bool
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM sessions WHERE id = $1 AND "user" = $2)`, r.PathValue("id"), p.UserID).Scan(&found); err != nil || !found {
			return err
		}
		return deleteSessions(ctx, tx, p.UserID, `"user" = $1 AND id = $2`, r.PathValue("id"))
	})
	if err != nil {
		return err
	}
	if !found {
		return httpx.ErrNotFound
	}
	m.announceAccount(ctx, p.UserID, "sessions")
	return httpx.NoContent(w, nil)
}

func (m *module) signOutOtherSessions(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	ctx := r.Context()
	sessionID := p.SessionID
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		if err := rotateTokenKeyExcept(ctx, tx, p.UserID, sessionID); err != nil {
			return err
		}
		return publishAuthEvent(ctx, tx, AuthEvent{Action: "sessions_revoked", User: p.UserID, IP: httpx.ClientIP(r)})
	})
	if err != nil {
		return err
	}
	m.announceAccount(ctx, p.UserID, "sessions")
	user, err := findAccount(ctx, m.db, p.UserID)
	if err != nil {
		return err
	}
	return m.respondWithToken(w, r, user, sessionID)
}
