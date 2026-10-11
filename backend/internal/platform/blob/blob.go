package blob

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/tenancy"
)

// ponytail: only the fs driver (shared volume); add an s3 driver behind the same methods when replicas can't share a volume.
type Store struct {
	root        *os.Root
	AccelPrefix string
	MayView     func(ctx context.Context, p auth.Principal, table, id string) bool
	types       sync.Map
	typeCount   atomic.Int64
	warming     sync.WaitGroup
}

var ProtectedTables = []string{"tasks", "moderation_items"}

// Public tables whose files moderation can take down; a moderation test fails when a kind with files is missing.
var ModeratedTables = []string{"beta_videos", "users"}

// StaffView: task photos for the gym's task managers, case files for whoever may open the moderation case.
func StaffView(pool *pgxpool.Pool, perms *tenancy.Permissions) func(context.Context, auth.Principal, string, string) bool {
	moderates := func(ctx context.Context, p auth.Principal, sql, id string) bool {
		rows, err := pool.Query(ctx, sql, id)
		if err != nil {
			return false
		}
		gyms, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil || len(gyms) == 0 {
			return false
		}
		if p.PlatformAdmin {
			return true
		}
		for _, gym := range gyms {
			if gym != "" && (perms.Can(ctx, p.UserID, gym, "manage_comments") || perms.Can(ctx, p.UserID, gym, "manage_reports")) {
				return true
			}
		}
		return false
	}
	return func(ctx context.Context, p auth.Principal, table, id string) bool {
		switch table {
		case "tasks":
			var gym string
			if pool.QueryRow(ctx, `SELECT gym FROM tasks WHERE id = $1`, id).Scan(&gym) == nil && perms.Can(ctx, p.UserID, gym, "manage_tasks") {
				return true
			}
			return moderates(ctx, p, `SELECT COALESCE(gym, '') FROM moderation_items WHERE content_type = 'task' AND content_id = $1`, id)
		case "moderation_items":
			return moderates(ctx, p, `SELECT COALESCE(gym, '') FROM moderation_items WHERE id = $1`, id)
		}
		return false
	}
}

func NewFS(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

func (s *Store) Put(ctx context.Context, key string, r io.Reader) error {
	if err := s.root.MkdirAll(path.Dir(key), 0o755); err != nil {
		return err
	}
	tmp := key + ".tmp" + randomString(6)
	f, err := s.root.Create(tmp)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, r)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		s.root.Remove(tmp)
		return err
	}
	s.types.Delete(key)
	return s.root.Rename(tmp, key)
}

// ponytail: cleared when full instead of LRU; 100k keys are ~10 MB and file names never change content.
const maxCachedTypes = 100_000

func (s *Store) cacheType(key, contentType string) {
	if s.typeCount.Add(1) > maxCachedTypes {
		s.types.Clear()
		s.typeCount.Store(1)
	}
	s.types.Store(key, contentType)
}

func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	return s.root.Open(key)
}

// Delete removes a file with its thumbs, or a whole record directory when key is "<table>/<id>".
func (s *Store) Delete(ctx context.Context, key string) error {
	dir, name := path.Split(key)
	if err := s.root.RemoveAll(dir + "thumbs_" + name); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := s.root.RemoveAll(key); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// Upload stores r under "<table>/<id>/<sanitized name>" (key ends with the client's file name) after checking sniffed type and size.
func (s *Store) Upload(ctx context.Context, key string, r io.Reader, allowed []string, maxBytes int64) (string, error) {
	dir, original := path.Split(key)
	buffered := bufio.NewReaderSize(r, 512)
	head, _ := buffered.Peek(512)
	if !slices.Contains(allowed, Sniff(head)) {
		return "", httpx.NewError(http.StatusBadRequest, "The file type is not allowed.")
	}
	limited := &io.LimitedReader{R: buffered, N: maxBytes + 1}
	filename := SanitizeName(original)
	if err := s.Put(ctx, dir+filename, limited); err != nil {
		return "", err
	}
	if limited.N == 0 {
		s.Delete(ctx, dir+filename)
		return "", httpx.NewError(http.StatusRequestEntityTooLarge, "The file is too large.")
	}
	return filename, nil
}

var (
	nonWord      = regexp.MustCompile(`[^a-z0-9]+`)
	nonExtension = regexp.MustCompile(`[^a-z0-9.]+`)
	validSegment = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.\-]*$`)
)

// SanitizeName follows PocketBase: snake_case base, max 100 chars, "_" + 10 random chars, lower-case extension.
func SanitizeName(original string) string {
	ext := path.Ext(original)
	base := strings.Trim(nonWord.ReplaceAllString(strings.ToLower(strings.TrimSuffix(original, ext)), "_"), "_")
	if len(base) > 100 {
		base = base[:100]
	}
	if base == "" {
		base = "file"
	}
	return base + "_" + randomString(10) + nonExtension.ReplaceAllString(strings.ToLower(ext), "")
}

func validKey(table, id, name string) bool {
	return validSegment.MatchString(table) && validSegment.MatchString(id) && validSegment.MatchString(name) && !strings.Contains(name, "..")
}

// Sniff detects the content type from the first bytes; SVG and QuickTime need help beyond net/http.
func Sniff(head []byte) string {
	detected, _, _ := mime.ParseMediaType(http.DetectContentType(head))
	switch {
	case len(head) >= 12 && string(head[4:8]) == "ftyp" && string(head[8:10]) == "qt":
		return "video/quicktime"
	case strings.HasPrefix(detected, "text/") && bytes.Contains(head, []byte("<svg")):
		return "image/svg+xml"
	}
	return detected
}

func randomString(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}
