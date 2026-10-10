package captcha

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

// Header carries the Cap redeem token (server/utils/cap.ts: HS256 {scope, jti, exp}).
const Header = "X-Cap-Token"

const nonceTTL = time.Hour

func Secret() string { return os.Getenv("CAP_SECRET") }

// Verify checks the token's signature, expiry and scope and burns its jti; no secret configured means no captcha.
func Verify(ctx context.Context, pool *pgxpool.Pool, secret, token, scope string) error {
	if secret == "" {
		return nil
	}
	if token == "" {
		return httpx.NewError(http.StatusBadRequest, "Captcha verification required.")
	}
	claims := jwt.MapClaims{}
	_, err := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"})).ParseWithClaims(token, claims, func(*jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	tokenScope, _ := claims["scope"].(string)
	jti, _ := claims["jti"].(string)
	if err != nil || tokenScope != scope || jti == "" {
		return httpx.NewError(http.StatusBadRequest, "Captcha verification failed.")
	}
	tag, err := pool.Exec(ctx, `INSERT INTO cap_nonces (id, jti) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING`, ids.New(), jti)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NewError(http.StatusBadRequest, "Captcha token already used.")
	}
	return nil
}

// Request is Verify with the token from the request header and CAP_SECRET from the environment.
func Request(ctx context.Context, pool *pgxpool.Pool, r *http.Request, scope string) error {
	return Verify(ctx, pool, Secret(), r.Header.Get(Header), scope)
}

// PruneNonces drops nonces older than any token could live; run hourly ("41 * * * *").
func PruneNonces(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM cap_nonces WHERE created < now() - $1::interval`, nonceTTL.String())
	return err
}
