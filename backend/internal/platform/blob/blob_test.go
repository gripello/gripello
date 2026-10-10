package blob

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/tenancy"
	"gripello/internal/platform/testkit"
)

func pngBytes(t *testing.T, width, height int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for x := range width {
		for y := range height {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 200, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func newStore(t *testing.T) (*Store, string) {
	dir := t.TempDir()
	s, err := NewFS(dir)
	if err != nil {
		t.Fatal(err)
	}
	return s, dir
}

func mux(s *Store) *http.ServeMux {
	s.MayView = func(_ context.Context, p auth.Principal, table, id string) bool { return p.UserID == "staff" }
	m := http.NewServeMux()
	m.Handle("GET /files/{table}/{id}/{name}", s.ServeFile("secret"))
	m.Handle("POST /files/token", s.IssueToken("secret"))
	return m
}

func TestUploadSanitizesNameAndChecksTypeAndSize(t *testing.T) {
	s, dir := newStore(t)
	ctx := context.Background()
	image := pngBytes(t, 10, 10)
	name, err := s.Upload(ctx, "routes/r1/My Photo (1).PNG", bytes.NewReader(image), []string{"image/png"}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^my_photo_1_[a-z0-9]{10}\.png$`).MatchString(name) {
		t.Errorf("name = %q", name)
	}
	if stored, _ := os.ReadFile(filepath.Join(dir, "routes", "r1", name)); !bytes.Equal(stored, image) {
		t.Error("stored bytes differ")
	}
	if _, err := s.Upload(ctx, "routes/r1/fake.png", strings.NewReader("<html>hi</html>"), []string{"image/png"}, 1<<20); err == nil {
		t.Error("html accepted as png")
	}
	if _, err := s.Upload(ctx, "routes/r1/big.png", bytes.NewReader(image), []string{"image/png"}, 10); err == nil {
		t.Error("oversized file accepted")
	}
	if entries, _ := os.ReadDir(filepath.Join(dir, "routes", "r1")); len(entries) != 1 {
		t.Errorf("rejected uploads left files: %v", entries)
	}
}

func TestSniffRecognisesSVGAndQuickTime(t *testing.T) {
	if got := Sniff([]byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`)); got != "image/svg+xml" {
		t.Errorf("svg = %q", got)
	}
	if got := Sniff([]byte("\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00")); got != "video/quicktime" {
		t.Errorf("mov = %q", got)
	}
}

func TestThumbSizes(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	if err := s.Put(ctx, "gyms/g1/logo_abc.png", bytes.NewReader(pngBytes(t, 400, 200))); err != nil {
		t.Fatal(err)
	}
	for size, want := range map[string]image.Point{
		"100x100":  {100, 100},
		"0x200":    {400, 200},
		"400x0":    {400, 200},
		"100x100f": {100, 50},
		"100x100t": {100, 100},
	} {
		key, err := s.Thumb(ctx, "gyms/g1/logo_abc.png", size)
		if err != nil {
			t.Fatal(err)
		}
		if key != "gyms/g1/thumbs_logo_abc.png/"+size+"_logo_abc.png" {
			t.Errorf("%s key = %s", size, key)
		}
		f, _ := s.Open(ctx, key)
		config, err := png.DecodeConfig(f)
		f.Close()
		if err != nil || config.Width != want.X || config.Height != want.Y {
			t.Errorf("%s = %dx%d (%v), want %v", size, config.Width, config.Height, err, want)
		}
	}
	if key, _ := s.Thumb(ctx, "gyms/g1/logo_abc.png", "123x45"); key != "gyms/g1/logo_abc.png" {
		t.Errorf("unknown size should serve the original, got %s", key)
	}
	if err := s.Delete(ctx, "gyms/g1/logo_abc.png"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(ctx, "gyms/g1/thumbs_logo_abc.png/100x100_logo_abc.png"); err == nil {
		t.Error("thumbs survive deleting the original")
	}
}

func TestServeFilePublicWithThumbAndETag(t *testing.T) {
	s, _ := newStore(t)
	s.Put(context.Background(), "gyms/g1/logo_abc.png", bytes.NewReader(pngBytes(t, 300, 300)))
	srv := httptest.NewServer(mux(s))
	defer srv.Close()

	res, err := http.Get(srv.URL + "/files/gyms/g1/logo_abc.png?thumb=100x100")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	config, _ := png.DecodeConfig(bytes.NewReader(body))
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || config.Width != 100 || res.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("status %d, type %q, width %d, cache %q", res.StatusCode, res.Header.Get("Content-Type"), config.Width, res.Header.Get("Cache-Control"))
	}
	req, _ := http.NewRequest("GET", srv.URL+"/files/gyms/g1/logo_abc.png?thumb=100x100", nil)
	req.Header.Set("If-None-Match", res.Header.Get("ETag"))
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusNotModified {
		t.Errorf("etag revalidation = %d", res.StatusCode)
	}
	for _, path := range []string{"/files/gyms/g1/..%2F..%2Fetc%2Fpasswd", "/files/gyms/g1/.hidden", "/files/gyms/g1/missing.png"} {
		if res, _ := http.Get(srv.URL + path); res.StatusCode != http.StatusNotFound {
			t.Errorf("%s = %d", path, res.StatusCode)
		}
	}
}

func requestToken(t *testing.T, s *Store, secret, userID, table, id string) (int, string) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/files/token", strings.NewReader(`{"table":"`+table+`","id":"`+id+`"}`))
	if userID != "" {
		req = req.WithContext(auth.WithPrincipal(req.Context(), auth.Principal{UserID: userID}))
	}
	s.IssueToken(secret).ServeHTTP(rec, req)
	var body struct{ Token string }
	json.NewDecoder(rec.Body).Decode(&body)
	return rec.Code, body.Token
}

func TestProtectedFilesNeedATokenForThatRecord(t *testing.T) {
	s, _ := newStore(t)
	s.Put(context.Background(), "tasks/t1/photo_abc.png", bytes.NewReader(pngBytes(t, 10, 10)))
	s.Put(context.Background(), "tasks/t2/photo_abc.png", bytes.NewReader(pngBytes(t, 10, 10)))
	m := mux(s)
	get := func(record, token string) int {
		rec := httptest.NewRecorder()
		m.ServeHTTP(rec, httptest.NewRequest("GET", "/files/tasks/"+record+"/photo_abc.png?token="+token, nil))
		return rec.Code
	}
	if code := get("t1", ""); code != http.StatusNotFound {
		t.Errorf("no token = %d", code)
	}
	if code, _ := requestToken(t, s, "secret", "", "tasks", "t1"); code != http.StatusUnauthorized {
		t.Errorf("guest token = %d", code)
	}
	if code, _ := requestToken(t, s, "secret", "climber", "tasks", "t1"); code != http.StatusNotFound {
		t.Errorf("token for a record the caller can't view = %d", code)
	}
	if code, _ := requestToken(t, s, "secret", "climber", "gyms", "g1"); code != http.StatusOK {
		t.Errorf("token for a public table = %d", code)
	}
	_, token := requestToken(t, s, "secret", "staff", "tasks", "t1")
	if code := get("t1", token); code != http.StatusOK {
		t.Errorf("valid token = %d", code)
	}
	if code := get("t2", token); code != http.StatusNotFound {
		t.Errorf("token reused for another record = %d", code)
	}
	if _, forged := requestToken(t, s, "other-secret", "staff", "tasks", "t1"); forged == "" || get("t1", forged) != http.StatusNotFound {
		t.Error("token signed with another secret accepted")
	}
	s.MayView = nil
	if code, _ := requestToken(t, s, "secret", "staff", "tasks", "t1"); code != http.StatusNotFound {
		t.Errorf("protected token without a view rule = %d", code)
	}
}

func TestStaffViewFollowsTaskAndModerationPermissions(t *testing.T) {
	ctx := context.Background()
	pool := testkit.Pool(t)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO users (id, username, token_key) VALUES ('setter', 'setter', 'k1'), ('mod', 'mod', 'k2'), ('climber', 'climber', 'k3')`,
		`INSERT INTO gyms (id, slug, name) VALUES ('g1', 'g1', 'G1')`,
		`INSERT INTO roles (id, gym, name, permissions) VALUES ('rt', 'g1', 'tasks', '{manage_tasks}'), ('rm', 'g1', 'mods', '{manage_comments}')`,
		`INSERT INTO memberships (id, "user", gym, role) VALUES ('m1', 'setter', 'g1', 'rt'), ('m2', 'mod', 'g1', 'rm')`,
		`INSERT INTO tasks (id, gym, kind, priority, status) VALUES ('t1', 'g1', 'defect', 2, 'open'), ('t2', 'g1', 'defect', 2, 'open')`,
		`INSERT INTO moderation_items (id, gym, content_type, content_id, state) VALUES ('c1', 'g1', 'task', 't1', 'unreviewed')`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	view := StaffView(pool, tenancy.New(pool))
	for _, c := range []struct {
		user, table, id string
		admin, want     bool
	}{
		{"setter", "tasks", "t2", false, true},
		{"mod", "tasks", "t1", false, true},
		{"mod", "tasks", "t2", false, false},
		{"mod", "moderation_items", "c1", false, true},
		{"setter", "moderation_items", "c1", false, false},
		{"climber", "tasks", "t1", false, false},
		{"climber", "moderation_items", "c1", true, true},
		{"climber", "moderation_items", "missing", true, false},
	} {
		if got := view(ctx, auth.Principal{UserID: c.user, PlatformAdmin: c.admin}, c.table, c.id); got != c.want {
			t.Errorf("%s (admin %v) on %s/%s = %v", c.user, c.admin, c.table, c.id, got)
		}
	}
}

func TestModeratedFilesLeaveCachesWithinADay(t *testing.T) {
	s, _ := newStore(t)
	s.Put(context.Background(), "beta_videos/b1/clip_abc.png", bytes.NewReader(pngBytes(t, 10, 10)))
	s.Put(context.Background(), "users/u1/avatar_abc.png", bytes.NewReader(pngBytes(t, 10, 10)))
	for _, path := range []string{"/files/beta_videos/b1/clip_abc.png", "/files/users/u1/avatar_abc.png", "/files/users/u1/avatar_abc.png?thumb=100x100"} {
		rec := httptest.NewRecorder()
		mux(s).ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if got := rec.Header().Get("Cache-Control"); rec.Code != http.StatusOK || got != "public, max-age=86400" {
			t.Errorf("%s: %d, cache %q", path, rec.Code, got)
		}
	}
}

func TestServeFileHandsTheBodyToNginx(t *testing.T) {
	s, _ := newStore(t)
	s.AccelPrefix = "/_blob/"
	s.Put(context.Background(), "gyms/g1/logo_abc.png", bytes.NewReader(pngBytes(t, 300, 300)))
	rec := httptest.NewRecorder()
	mux(s).ServeHTTP(rec, httptest.NewRequest("GET", "/files/gyms/g1/logo_abc.png?thumb=100x100", nil))
	if got := rec.Header().Get("X-Accel-Redirect"); got != "/_blob/gyms/g1/thumbs_logo_abc.png/100x100_logo_abc.png" || rec.Body.Len() != 0 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("accel %q, body %d bytes, type %q", got, rec.Body.Len(), rec.Header().Get("Content-Type"))
	}
}

func pngHeader(width, height uint32) []byte {
	ihdr := binary.BigEndian.AppendUint32(nil, width)
	ihdr = binary.BigEndian.AppendUint32(ihdr, height)
	ihdr = append(ihdr, 8, 6, 0, 0, 0)
	chunk := append([]byte("IHDR"), ihdr...)
	out := append([]byte("\x89PNG\r\n\x1a\n"), binary.BigEndian.AppendUint32(nil, uint32(len(ihdr)))...)
	out = append(out, chunk...)
	return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(chunk))
}

func TestThumbSkipsHugeSourcesAndWaitsForASlot(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	s.Put(ctx, "gyms/g1/huge_abc.png", bytes.NewReader(pngHeader(6000, 5000)))
	if key, err := s.Thumb(ctx, "gyms/g1/huge_abc.png", "100x100"); err != nil || key != "gyms/g1/huge_abc.png" {
		t.Fatalf("30 MP source: key %q, err %v; want the original", key, err)
	}
	s.Put(ctx, "gyms/g1/logo_abc.png", bytes.NewReader(pngBytes(t, 50, 50)))
	for range cap(thumbSlots) {
		thumbSlots <- struct{}{}
	}
	defer func() {
		for range cap(thumbSlots) {
			<-thumbSlots
		}
	}()
	busy, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	if _, err := s.Thumb(busy, "gyms/g1/logo_abc.png", "32x32"); err == nil {
		t.Fatal("thumb generated while every slot was taken")
	}
}

func TestServeFileRemembersTheTypeSoNginxServesWithoutAFileRead(t *testing.T) {
	s, dir := newStore(t)
	s.AccelPrefix = "/_blob/"
	ctx := context.Background()
	s.Put(ctx, "gyms/g1/logo_abc.png", bytes.NewReader(pngBytes(t, 50, 50)))
	get := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux(s).ServeHTTP(rec, httptest.NewRequest("GET", "/files/gyms/g1/logo_abc.png", nil))
		return rec
	}
	get()
	file := filepath.Join(dir, "gyms/g1/logo_abc.png")
	os.Chmod(file, 0)
	if rec := get(); rec.Header().Get("X-Accel-Redirect") != "/_blob/gyms/g1/logo_abc.png" || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("second request opened the file again: %d %v", rec.Code, rec.Header())
	}
	os.Remove(file)
	if rec := get(); rec.Code != http.StatusNotFound || rec.Header().Get("Cache-Control") != "" {
		t.Fatalf("deleted file: %d, cache %q; want Go's uncached 404", rec.Code, rec.Header().Get("Cache-Control"))
	}
}

func TestWarmThumbsRendersSizesInTheBackground(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	s.Put(ctx, "users/u1/avatar_abc.png", bytes.NewReader(pngBytes(t, 300, 200)))
	s.WarmThumbs("users/u1/avatar_abc.png", "100x100", "1600x400")
	s.warming.Wait()
	for _, size := range []string{"100x100", "1600x400"} {
		if _, err := s.root.Stat("users/u1/thumbs_avatar_abc.png/" + size + "_avatar_abc.png"); err != nil {
			t.Errorf("%s not warmed: %v", size, err)
		}
	}
}

func TestVipsArgsMirrorThePocketBaseModes(t *testing.T) {
	for _, c := range []struct {
		width, height int
		mode          string
		want          []string
	}{
		{100, 100, "", []string{"100", "--height", "100", "--crop", "centre"}},
		{100, 100, "t", []string{"100", "--height", "100", "--crop", "low"}},
		{100, 100, "b", []string{"100", "--height", "100", "--crop", "high"}},
		{100, 100, "f", []string{"100", "--height", "100", "--size", "down"}},
		{0, 200, "", []string{"10000000", "--height", "200"}},
		{400, 0, "", []string{"400", "--height", "10000000"}},
	} {
		got := vipsArgs("out.png", c.width, c.height, c.mode)
		if want := append([]string{"thumbnail_source", "[descriptor=0]", "out.png"}, c.want...); !slices.Equal(got, want) {
			t.Errorf("%dx%d%s = %v, want %v", c.width, c.height, c.mode, got, want)
		}
	}
}
