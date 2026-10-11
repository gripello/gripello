package authn

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/ids"
)

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type account struct {
	ID             string
	Email          string
	Username       string
	Firstname      string
	Name           string
	Language       string
	PasswordHash   string
	TokenKey       string
	Verified       bool
	SuspendedUntil *time.Time
}

func (a account) label() string { return firstNonEmpty(a.Email, a.Username, a.ID) }

const accountColumns = `id, email, username, firstname, name, language, password_hash, token_key, verified, suspended_until`

func scanAccount(row pgx.Row) (account, error) {
	var a account
	err := row.Scan(&a.ID, &a.Email, &a.Username, &a.Firstname, &a.Name, &a.Language, &a.PasswordHash, &a.TokenKey, &a.Verified, &a.SuspendedUntil)
	return a, err
}

func findAccount(ctx context.Context, q querier, id string) (account, error) {
	return scanAccount(q.QueryRow(ctx, `SELECT `+accountColumns+` FROM users WHERE id = $1`, id))
}

// The identity is an email or a username, matched like PocketBase: email exactly, username case-insensitively.
func findAccountByIdentity(ctx context.Context, q querier, identity string) (account, error) {
	return scanAccount(q.QueryRow(ctx, `SELECT `+accountColumns+` FROM users
		WHERE (email <> '' AND lower(email) = lower($1)) OR lower(username) = lower($1)
		ORDER BY (lower(email) = lower($1)) DESC LIMIT 1`, identity))
}

func findAccountByEmail(ctx context.Context, q querier, email string) (account, error) {
	return scanAccount(q.QueryRow(ctx, `SELECT `+accountColumns+` FROM users WHERE email <> '' AND lower(email) = lower($1)`, email))
}

func emailTaken(ctx context.Context, q querier, email, exceptID string) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2)`, email, exceptID).Scan(&taken)
	return taken, err
}

func usernameTaken(ctx context.Context, q querier, username string) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($1))`, username).Scan(&taken)
	return taken, err
}

func userRecord(ctx context.Context, q querier, id string) (json.RawMessage, error) {
	var record json.RawMessage
	err := q.QueryRow(ctx, `SELECT to_jsonb(u) - 'password_hash' - 'token_key' FROM users u WHERE id = $1`, id).Scan(&record)
	return record, err
}

const tokenKeyAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"

func newTokenKey() string {
	b := make([]byte, 50)
	rand.Read(b)
	for i := range b {
		b[i] = tokenKeyAlphabet[int(b[i])%len(tokenKeyAlphabet)]
	}
	return string(b)
}

// rotateTokenKey invalidates every token of the user and ends all their sessions (password or email change).
func rotateTokenKey(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `UPDATE users SET token_key = $2 WHERE id = $1`, userID, newTokenKey()); err != nil {
		return err
	}
	return deleteSessions(ctx, tx, userID, `"user" = $1`)
}

func deleteSessions(ctx context.Context, tx pgx.Tx, userID, where string, args ...any) error {
	rows, err := tx.Query(ctx, `DELETE FROM sessions WHERE `+where+` RETURNING id`, append([]any{userID}, args...)...)
	if err != nil {
		return err
	}
	revoked, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	return publishSessionRevoked(ctx, tx, userID, revoked)
}

type session struct {
	ID        string     `json:"id"`
	Created   time.Time  `json:"created"`
	Method    string     `json:"method"`
	UserAgent string     `json:"user_agent"`
	IP        string     `json:"ip"`
	LastSeen  *time.Time `json:"last_seen"`
	Current   bool       `json:"current"`
}

func insertSession(ctx context.Context, q querier, userID, method, userAgent, ip string) (string, error) {
	id := ids.New()
	_, err := q.Exec(ctx, `INSERT INTO sessions (id, "user", method, user_agent, ip, last_seen) VALUES ($1, $2, $3, $4, $5, now())`,
		id, userID, method, truncateRunes(userAgent, sessionUserAgentMax), ip)
	return id, err
}

func listSessions(ctx context.Context, q querier, userID, currentID string) ([]session, error) {
	rows, err := q.Query(ctx, `SELECT id, created, method, user_agent, ip, last_seen FROM sessions WHERE "user" = $1 ORDER BY last_seen DESC NULLS LAST`, userID)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (session, error) {
		var s session
		err := row.Scan(&s.ID, &s.Created, &s.Method, &s.UserAgent, &s.IP, &s.LastSeen)
		s.Current = s.ID == currentID
		return s, err
	})
	if items == nil {
		items = []session{}
	}
	return items, err
}

type factor struct {
	ID             string     `json:"id"`
	Kind           string     `json:"kind"`
	Name           string     `json:"name"`
	Created        time.Time  `json:"created"`
	LastUsed       *time.Time `json:"last_used"`
	Secret         string     `json:"-"`
	LastStep       int64      `json:"-"`
	CredentialID   string     `json:"-"`
	PublicKey      string     `json:"-"`
	SignCount      int64      `json:"-"`
	AAGUID         string     `json:"-"`
	Transports     []string   `json:"-"`
	BackupEligible bool       `json:"-"`
	BackupState    bool       `json:"-"`
	Attestation    string     `json:"-"`
	User           string     `json:"-"`
}

const factorColumns = `id, kind, name, created, last_used, secret, last_step, credential_id, public_key, sign_count, aaguid,
	COALESCE(transports, '[]'), backup_eligible, backup_state, attestation_type, "user"`

func scanFactor(row pgx.Row) (factor, error) {
	var f factor
	var transports []byte
	err := row.Scan(&f.ID, &f.Kind, &f.Name, &f.Created, &f.LastUsed, &f.Secret, &f.LastStep, &f.CredentialID, &f.PublicKey,
		&f.SignCount, &f.AAGUID, &transports, &f.BackupEligible, &f.BackupState, &f.Attestation, &f.User)
	json.Unmarshal(transports, &f.Transports)
	return f, err
}

func listFactors(ctx context.Context, q querier, userID string) ([]factor, error) {
	rows, err := q.Query(ctx, `SELECT `+factorColumns+` FROM mfa_factors WHERE "user" = $1 ORDER BY created`, userID)
	if err != nil {
		return nil, err
	}
	factors, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (factor, error) { return scanFactor(row) })
	if factors == nil {
		factors = []factor{}
	}
	return factors, err
}

func findOwnFactor(ctx context.Context, q querier, userID, id string) (factor, error) {
	return scanFactor(q.QueryRow(ctx, `SELECT `+factorColumns+` FROM mfa_factors WHERE id = $1 AND "user" = $2`, id, userID))
}

func findPasskey(ctx context.Context, q querier, credentialID string) (factor, error) {
	return scanFactor(q.QueryRow(ctx, `SELECT `+factorColumns+` FROM mfa_factors WHERE credential_id = $1 AND kind = 'passkey'`, credentialID))
}

func insertFactor(ctx context.Context, q querier, userID string, f factor) (factor, error) {
	transports, _ := json.Marshal(f.Transports)
	algorithm, digits, period, userHandle := "", 0, 0, ""
	if f.Kind == methodTOTP {
		algorithm, digits, period = totpAlgorithm, totpDigits, totpPeriod
	} else {
		userHandle = b64url.EncodeToString([]byte(userID))
	}
	return scanFactor(q.QueryRow(ctx, `INSERT INTO mfa_factors (id, "user", kind, name, secret, algorithm, digits, period, last_step,
		credential_id, public_key, sign_count, aaguid, transports, backup_eligible, backup_state, attestation_type, user_handle)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		RETURNING `+factorColumns,
		ids.New(), userID, f.Kind, f.Name, f.Secret, algorithm, digits, period, f.LastStep,
		f.CredentialID, f.PublicKey, f.SignCount, f.AAGUID, transports, f.BackupEligible, f.BackupState, f.Attestation, userHandle))
}

// claimTOTPStep is atomic: a code is accepted once even when the same step arrives in parallel.
func claimTOTPStep(ctx context.Context, q querier, factorID string, step int64) bool {
	tag, err := q.Exec(ctx, `UPDATE mfa_factors SET last_step = $2, last_used = now() WHERE id = $1 AND last_step < $2`, factorID, step)
	return err == nil && tag.RowsAffected() == 1
}

func recoveryCodesLeft(ctx context.Context, q querier, userID string) int {
	var left int
	q.QueryRow(ctx, `SELECT COALESCE((SELECT jsonb_array_length(codes) FROM mfa_recovery_codes WHERE "user" = $1), 0)`, userID).Scan(&left)
	return left
}

func storeRecoveryCodes(ctx context.Context, q querier, userID string, hashes []string) error {
	codes, _ := json.Marshal(hashes)
	_, err := q.Exec(ctx, `INSERT INTO mfa_recovery_codes (id, "user", codes) VALUES ($1, $2, $3)
		ON CONFLICT ("user") DO UPDATE SET codes = EXCLUDED.codes`, ids.New(), userID, codes)
	return err
}

func useRecoveryCode(ctx context.Context, q querier, userID, hash string) bool {
	tag, err := q.Exec(ctx, `UPDATE mfa_recovery_codes SET codes = codes - $2::text WHERE "user" = $1 AND codes ? $2::text`, userID, hash)
	return err == nil && tag.RowsAffected() == 1
}

func restoreRecoveryCode(ctx context.Context, q querier, userID, hash string) error {
	_, err := q.Exec(ctx, `UPDATE mfa_recovery_codes SET codes = codes || to_jsonb($2::text) WHERE "user" = $1`, userID, hash)
	return err
}

const challengeTTL = 10 * time.Minute

type challenge struct {
	ID     string
	User   string
	Method string
	Data   []byte
}

func insertChallenge(ctx context.Context, q querier, kind, userID, method string, data []byte) (string, error) {
	id := ids.New() + ids.New()
	var user *string
	if userID != "" {
		user = &userID
	}
	_, err := q.Exec(ctx, `INSERT INTO mfa_challenges (id, kind, "user", method, data) VALUES ($1, $2, $3, $4, $5)`, id, kind, user, method, data)
	return id, err
}

func findChallenge(ctx context.Context, q querier, kind, id string) (challenge, error) {
	c := challenge{ID: id}
	err := q.QueryRow(ctx, `SELECT COALESCE("user", ''), method, data FROM mfa_challenges
		WHERE id = $1 AND kind = $2 AND created > now() - $3::interval`, id, kind, challengeTTL.String()).Scan(&c.User, &c.Method, &c.Data)
	return c, err
}

// takeChallenge consumes the challenge so it can't be replayed.
func takeChallenge(ctx context.Context, q querier, kind, id string) (challenge, error) {
	c := challenge{ID: id}
	err := q.QueryRow(ctx, `DELETE FROM mfa_challenges WHERE id = $1 AND kind = $2 AND created > now() - $3::interval
		RETURNING COALESCE("user", ''), method, data`, id, kind, challengeTTL.String()).Scan(&c.User, &c.Method, &c.Data)
	return c, err
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func isUniqueViolation(err error, index string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && strings.Contains(pgErr.ConstraintName, index)
}
