package backups

import (
	"archive/tar"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/testapp"
)

type fixture struct {
	t       *testing.T
	app     *platform.App
	handler http.Handler
	dir     string
}

func newFixture(t *testing.T) *fixture {
	app := testapp.App(t)
	dir := t.TempDir()
	app.Cfg.BackupDir = dir
	app.Cfg.BlobDir = t.TempDir()
	Register(app)
	return &fixture{t: t, app: app, handler: testapp.Handler(app), dir: dir}
}

func (f *fixture) m() *module {
	return &module{app: f.app, dir: f.dir}
}

// admin returns a platform admin token whose session confirmed the password confirmed seconds ago (or not).
func (f *fixture) admin(confirmed bool) string {
	f.t.Helper()
	id, key, sid := ids.New(), ids.New()+ids.New(), ids.New()
	ctx := context.Background()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users (id, email, token_key, username, platform_admin) VALUES ($1, $2, $3, $1, true)`, []any{id, id + "@example.com", key}},
		{`INSERT INTO sessions (id, "user", reauthenticated_at) VALUES ($1, $2, CASE WHEN $3 THEN now() END)`, []any{sid, id, confirmed}},
	} {
		if _, err := f.app.DB.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			f.t.Fatal(err)
		}
	}
	token, err := f.app.Tokens.Sign(id, key, sid)
	if err != nil {
		f.t.Fatal(err)
	}
	return token
}

func (f *fixture) call(method, path, token, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	request.Header.Set("Authorization", token)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func touch(t *testing.T, path string, content string, age time.Duration) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().Add(-age)
	os.Chtimes(path, stamp, stamp)
}

func TestPruneKeepsTheNewestAndDropsStalePartials(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"gripello-20261001-020000.tar", "gripello-20261002-020000.tar", "gripello-20261003-020000.tar", "notes.txt"} {
		touch(t, filepath.Join(dir, name), "x", 0)
	}
	touch(t, filepath.Join(dir, "gripello-20260901-020000.tar.partial"), "x", 48*time.Hour)
	touch(t, filepath.Join(dir, "gripello-20261004-020000.tar.partial"), "x", time.Minute)
	if err := prune(dir, 2); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	var left []string
	for _, entry := range entries {
		left = append(left, entry.Name())
	}
	want := []string{"gripello-20261002-020000.tar", "gripello-20261003-020000.tar", "gripello-20261004-020000.tar.partial", "notes.txt"}
	if !slices.Equal(left, want) {
		t.Errorf("left = %v, want %v", left, want)
	}
}

func TestArchiveSkipsThumbnailsAndKeepsStorageLayout(t *testing.T) {
	dir, storage := t.TempDir(), t.TempDir()
	touch(t, filepath.Join(dir, "database.dump"), "dump", 0)
	touch(t, filepath.Join(storage, "gyms", "g1", "logo.png"), "logo", 0)
	touch(t, filepath.Join(storage, "gyms", "g1", "thumbs_logo.png", "100x100_logo.png"), "thumb", 0)
	touch(t, filepath.Join(storage, "account_exports", "e1", "gripello-data.zip"), "zip", 0)
	out := filepath.Join(dir, "out.tar")
	if err := writeArchive(out, filepath.Join(dir, "database.dump"), storage, true); err != nil {
		t.Fatal(err)
	}
	f, _ := os.Open(out)
	defer f.Close()
	var names []string
	reader := tar.NewReader(f)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, header.Name)
	}
	if !slices.Equal(names, []string{"database.dump", "storage/gyms/g1/logo.png"}) {
		t.Errorf("archive = %v", names)
	}
}

func TestBackupEndpointsNeedAdminsAndAFreshPassword(t *testing.T) {
	f := newFixture(t)
	touch(t, filepath.Join(f.dir, "gripello-20261003-020000.tar"), "archive", 0)
	stale, fresh := f.admin(false), f.admin(true)

	if code := f.call("GET", "/platform/backups", "", "").Code; code != http.StatusUnauthorized {
		t.Errorf("guest = %d", code)
	}
	list := f.call("GET", "/platform/backups", stale, "")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"name":"gripello-20261003-020000.tar"`) || !strings.Contains(list.Body.String(), `"keep":7`) {
		t.Errorf("list = %d %s", list.Code, list.Body)
	}
	path := "/platform/backups/gripello-20261003-020000.tar"
	if code := f.call("GET", path, stale, "").Code; code != http.StatusForbidden {
		t.Errorf("download without a fresh password = %d", code)
	}
	if got := f.call("GET", path, fresh, ""); got.Code != http.StatusOK || got.Body.String() != "archive" || !strings.Contains(got.Header().Get("Content-Disposition"), "attachment") {
		t.Errorf("download = %d %q", got.Code, got.Body)
	}
	for _, bad := range []string{"/platform/backups/database.dump", "/platform/backups/gripello-20261003-020000.tar.partial", "/platform/backups/gripello-29991231-000000.tar"} {
		if code := f.call("GET", bad, fresh, "").Code; code != http.StatusNotFound {
			t.Errorf("%s = %d", bad, code)
		}
	}
	if code := f.call("PUT", "/platform/backups/settings", fresh, `{"keep":400}`).Code; code != http.StatusBadRequest {
		t.Errorf("keep 400 = %d", code)
	}
	if code := f.call("PUT", "/platform/backups/settings", fresh, `{"keep":3,"hour":24}`).Code; code != http.StatusBadRequest {
		t.Errorf("hour 24 = %d", code)
	}
	if code := f.call("PUT", "/platform/backups/settings", fresh, `{"keep":3,"include_storage":false,"hour":5}`).Code; code != http.StatusOK {
		t.Errorf("settings = %d", code)
	}
	if got := f.call("GET", "/platform/backups", stale, ""); !strings.Contains(got.Body.String(), `"hour":5`) {
		t.Errorf("saved hour = %s", got.Body)
	}
	if code := f.call("POST", "/platform/backups", stale, "").Code; code != http.StatusAccepted {
		t.Errorf("run now = %d", code)
	}
	if code := f.call("DELETE", path, fresh, "").Code; code != http.StatusNoContent {
		t.Errorf("delete = %d", code)
	}
	if _, err := os.Stat(filepath.Join(f.dir, "gripello-20261003-020000.tar")); !os.IsNotExist(err) {
		t.Error("archive still on disk")
	}
}

func TestBackupsAreOffWithoutABackupDir(t *testing.T) {
	app := testapp.App(t)
	app.Cfg.BackupDir = ""
	Register(app)
	f := &fixture{t: t, app: app, handler: testapp.Handler(app)}
	token := f.admin(true)
	if got := f.call("GET", "/platform/backups", token, ""); got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"enabled":false`) {
		t.Errorf("list = %d %s", got.Code, got.Body)
	}
	if code := f.call("POST", "/platform/backups", token, "").Code; code != http.StatusNotFound {
		t.Errorf("run now = %d", code)
	}
}

func TestAFailedRunIsShownOnThePage(t *testing.T) {
	f := newFixture(t)
	t.Setenv("PATH", "")
	if err := f.m().runAndRecord(context.Background()); err == nil {
		t.Fatal("run without pg_dump succeeded")
	}
	got := f.call("GET", "/platform/backups", f.admin(false), "").Body.String()
	if !strings.Contains(got, `"pg_dump":false`) || !strings.Contains(got, `"disk_free":`) || !strings.Contains(got, `"last_error":"pg_dump: `) || strings.Contains(got, `"last_run":null`) {
		t.Errorf("list = %s", got)
	}
}
