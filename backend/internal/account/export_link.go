package account

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/jobs"
	gmail "gripello/internal/platform/mail"
)

const (
	exportJob      = "account.export"
	exportLifetime = 7 * 24 * time.Hour
	exportTable    = "account_exports"
	exportNotice   = "account_export_ready"
	exportFailed   = "account_export_failed"
	exportPage     = "/account/export"
)

func exportLink(token string) string { return exportPage + "/" + token }

// runExport writes the archive into the blob store under a random name, replaces the user's older exports and
// mails the tokenised link; the notification only links the sign-in page, so the token never reaches push services.
func (m *module) runExport(ctx context.Context, job jobs.Job) error {
	userID := job.Key
	var email, firstname, language string
	err := m.db.QueryRow(ctx, `SELECT email, firstname, language FROM users WHERE id = $1`, userID).Scan(&email, &firstname, &language)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	recipient := exportRecipient{userID, email, firstname, language}
	parts, size, err := m.collectExport(ctx, userID)
	if err != nil {
		return err
	}
	id := ids.New()
	if size > exportMaxBytes {
		slog.Warn("account: export too large", "user", userID, "bytes", size)
		return m.finishExport(ctx, recipient, id, nil, nil, "too_large")
	}
	secret := make([]byte, 32)
	rand.Read(secret)
	token := base64.RawURLEncoding.EncodeToString(secret)
	key := exportTable + "/" + id + "/gripello-data-" + ids.New() + ".zip"
	reader, writer := io.Pipe()
	go func() { writer.CloseWithError(m.streamExport(ctx, writer, parts)) }()
	if err := m.blob.Put(ctx, key, reader); err != nil {
		reader.CloseWithError(err)
		m.blob.Delete(ctx, exportTable+"/"+id)
		if errors.Is(err, errExportTooLarge) {
			slog.Warn("account: export too large", "user", userID)
			return m.finishExport(ctx, recipient, id, nil, nil, "too_large")
		}
		return err
	}
	tokenHash := ids.Hash(token)
	if err := m.finishExport(ctx, recipient, id, &tokenHash, &key, ""); err != nil {
		m.blob.Delete(ctx, exportTable+"/"+id)
		return err
	}
	m.mailExport(ctx, recipient, gmail.Content{Key: "accountExport", Name: firstname, Action: exportLink(token)})
	return nil
}

type exportRecipient struct{ id, email, firstname, language string }

// finishExport replaces the user's older exports with this one (or its failure) and notifies the user.
func (m *module) finishExport(ctx context.Context, to exportRecipient, id string, tokenHash, file *string, failure string) error {
	var older []string
	err := pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `DELETE FROM account_exports WHERE "user" = $1 RETURNING id`, to.id)
		if err != nil {
			return err
		}
		if older, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO account_exports (id, "user", token_hash, file, expires_at, failure) VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))`,
			id, to.id, tokenHash, file, time.Now().Add(exportLifetime), failure); err != nil {
			return err
		}
		notice := exportNotice
		if failure != "" {
			notice = exportFailed
		}
		return events.PublishNotify(ctx, tx, "", events.Notify{Type: notice, Users: []string{to.id}, Params: map[string]any{}, URL: exportPage})
	})
	if err != nil {
		return err
	}
	for _, old := range older {
		m.blob.Delete(ctx, exportTable+"/"+old)
	}
	if failure != "" {
		m.mailExport(ctx, to, gmail.Content{Key: "accountExportTooLarge", Name: to.firstname, Action: exportPage})
	}
	return nil
}

func (m *module) mailExport(ctx context.Context, to exportRecipient, content gmail.Content) {
	if to.email == "" || m.app.MailTemplates == nil {
		return
	}
	if _, err := m.app.MailTemplates.Send(ctx, m.app.Mail, m.app.MailTemplates.AppBrand(), content, []gmail.Recipient{{Address: to.email, Language: to.language}}); err != nil {
		slog.Error("account: export mail failed", "user", to.id, "error", err)
	}
}

// downloadExport needs only the token, so the mailed link also opens in a browser without a session; unknown,
// expired and orphaned links all answer 404.
func (m *module) downloadExport(w http.ResponseWriter, r *http.Request) error {
	var key string
	var created time.Time
	err := m.db.QueryRow(r.Context(), `SELECT file, created FROM account_exports
		WHERE token_hash = $1 AND expires_at > now() AND "user" IS NOT NULL`, ids.Hash(r.PathValue("token"))).Scan(&key, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	return m.serveExport(w, r, key, created)
}

func (m *module) ownExport(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	out := map[string]any{"status": "none"}
	var created, expires time.Time
	var failure *string
	err = m.db.QueryRow(r.Context(), `SELECT created, expires_at, failure FROM account_exports WHERE "user" = $1 AND expires_at > now()
		ORDER BY created DESC LIMIT 1`, p.UserID).Scan(&created, &expires, &failure)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return err
	case failure != nil:
		out = map[string]any{"status": *failure, "created": created}
	default:
		out = map[string]any{"status": "ready", "created": created, "expires_at": expires}
	}
	return httpx.Respond(w, http.StatusOK, out, nil)
}

func (m *module) downloadOwnExport(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	var key string
	var created time.Time
	err = m.db.QueryRow(r.Context(), `SELECT file, created FROM account_exports WHERE "user" = $1 AND expires_at > now() AND file IS NOT NULL
		ORDER BY created DESC LIMIT 1`, p.UserID).Scan(&key, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	return m.serveExport(w, r, key, created)
}

func (m *module) serveExport(w http.ResponseWriter, r *http.Request, key string, created time.Time) error {
	file, err := m.blob.Open(r.Context(), key)
	if errors.Is(err, fs.ErrNotExist) {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	defer file.Close()
	seeker, ok := file.(io.ReadSeeker)
	if !ok {
		return errors.New("account: export blob is not seekable")
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="gripello-data-`+created.UTC().Format(time.DateOnly)+`.zip"`)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.ServeContent(w, r, "", created, seeker)
	return nil
}

func (m *module) pruneExports(ctx context.Context) error {
	rows, err := m.db.Query(ctx, `DELETE FROM account_exports WHERE expires_at <= now() OR "user" IS NULL RETURNING id`)
	if err != nil {
		return err
	}
	gone, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range gone {
		if err := m.blob.Delete(ctx, exportTable+"/"+id); err != nil {
			slog.Error("account: removing an expired export failed", "error", err)
		}
	}
	return nil
}
