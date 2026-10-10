package blob

import (
	"io"
	"net/http"
	"os"
	"slices"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
)

const fileTokenDuration = 2 * time.Minute

type fileClaims struct {
	jwt.RegisteredClaims
	ID     string `json:"id"`
	Type   string `json:"type"`
	Table  string `json:"table"`
	Record string `json:"record"`
}

// File tokens get their own key so they can never pass as auth tokens.
func fileTokenKey(secret string) []byte { return []byte(secret + "_file") }

func (s *Store) IssueToken(secret string) http.Handler {
	return httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		principal, err := auth.Require(r.Context())
		if err != nil {
			return err
		}
		var body struct {
			Table string `json:"table"`
			ID    string `json:"id"`
		}
		if err := httpx.Decode(r, &body); err != nil {
			return err
		}
		if body.Table == "_pb_users_auth_" {
			body.Table = "users"
		}
		if !validKey(body.Table, body.ID, "x") {
			return httpx.NewError(http.StatusBadRequest, "table and id are required.")
		}
		if slices.Contains(ProtectedTables, body.Table) && (s.MayView == nil || !s.MayView(r.Context(), principal, body.Table, body.ID)) {
			return httpx.ErrNotFound
		}
		claims := fileClaims{
			RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(fileTokenDuration))},
			ID:               principal.UserID,
			Type:             "file",
			Table:            body.Table,
			Record:           body.ID,
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(fileTokenKey(secret))
		if err != nil {
			return err
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"token": token})
		return nil
	})
}

func validFileToken(secret, token, table, id string) bool {
	var claims fileClaims
	_, err := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"})).ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) {
		return fileTokenKey(secret), nil
	})
	return err == nil && claims.Type == "file" && claims.ID != "" && claims.Table == table && claims.Record == id
}

// ServeFile serves GET /files/{table}/{id}/{name}?thumb=&token=.
func (s *Store) ServeFile(secret string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		table, id, name := r.PathValue("table"), r.PathValue("id"), r.PathValue("name")
		if table == "_pb_users_auth_" {
			table = "users"
		}
		if !validKey(table, id, name) {
			httpx.Fail(w, httpx.ErrNotFound)
			return
		}
		protected := slices.Contains(ProtectedTables, table)
		if protected && !validFileToken(secret, r.URL.Query().Get("token"), table, id) {
			httpx.Fail(w, httpx.ErrNotFound)
			return
		}
		key := table + "/" + id + "/" + name
		if thumb := r.URL.Query().Get("thumb"); thumb != "" {
			thumbKey, err := s.Thumb(r.Context(), key, thumb)
			if err != nil {
				httpx.Fail(w, mapNotFound(err))
				return
			}
			key = thumbKey
		}
		// The stat keeps a deleted file on Go's uncached 404; nginx's would carry the immutable Cache-Control.
		if contentType, ok := s.types.Load(key); ok && s.AccelPrefix != "" && s.isFile(key) {
			setFileHeaders(w.Header(), contentType.(string), table)
			w.Header().Set("X-Accel-Redirect", s.AccelPrefix+key)
			return
		}
		f, err := s.root.Open(key)
		if err != nil {
			httpx.Fail(w, mapNotFound(err))
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || info.IsDir() {
			httpx.Fail(w, httpx.ErrNotFound)
			return
		}
		head := make([]byte, 512)
		n, _ := io.ReadFull(f, head)
		f.Seek(0, io.SeekStart)
		contentType := Sniff(head[:n])
		s.cacheType(key, contentType)

		setFileHeaders(w.Header(), contentType, table)
		if s.AccelPrefix != "" {
			w.Header().Set("X-Accel-Redirect", s.AccelPrefix+key)
			return
		}
		w.Header().Set("ETag", `"`+strconv.FormatInt(info.ModTime().UnixNano(), 36)+"-"+strconv.FormatInt(info.Size(), 36)+`"`)
		http.ServeContent(w, r, name, info.ModTime(), f)
	})
}

// Uploaded names carry a random suffix, so a URL's content never changes; nginx adds its own ETag on X-Accel-Redirect.
// Files moderation can hide must leave caches within a day instead of staying for a year.
func setFileHeaders(header http.Header, contentType, table string) {
	header.Set("Content-Type", contentType)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; sandbox")
	switch {
	case slices.Contains(ProtectedTables, table):
		header.Set("Cache-Control", "private, no-store")
	case slices.Contains(ModeratedTables, table):
		header.Set("Cache-Control", "public, max-age=86400")
	default:
		header.Set("Cache-Control", "public, max-age=31536000, immutable")
	}
}

func (s *Store) isFile(key string) bool {
	info, err := s.root.Stat(key)
	return err == nil && !info.IsDir()
}

func mapNotFound(err error) error {
	if os.IsNotExist(err) {
		return httpx.ErrNotFound
	}
	return err
}
