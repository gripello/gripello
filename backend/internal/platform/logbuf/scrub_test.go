package logbuf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"gripello/internal/platform/httpx"
)

func TestAddressesAndRequestURLsNeverReachTheLogs(t *testing.T) {
	var out bytes.Buffer
	b := New(&out)
	smtp := fmt.Errorf("authn: sending mail: %w", errors.New("550 5.1.1 <Jane.Doe+x@Mail.example.co.uk>: Recipient address rejected"))
	download := &url.Error{Op: "Get", URL: "https://lh3.example.com/a/ACg8oc-secret=s96-c?token=abc", Err: errors.New("dial tcp: i/o timeout")}
	slog.New(b).Error("mail failed for jane@example.org", "error", smtp, "avatar", fmt.Errorf("avatar: %w", download), "note", "ask bob@example.net")

	got := b.queue.take()[0]
	if got.Message != "mail failed for <email>" || got.Attrs["error"] != "authn: sending mail: 550 5.1.1 <<email>>: Recipient address rejected" ||
		got.Attrs["avatar"] != `avatar: Get "<url>": dial tcp: i/o timeout` || got.Attrs["note"] != "ask <email>" {
		t.Fatalf("entry = %+v", got)
	}
	for _, leak := range []string{"Jane.Doe", "jane@", "bob@", "lh3.example.com", "token=abc"} {
		if strings.Contains(out.String(), leak) {
			t.Errorf("stderr leaks %q: %s", leak, out.String())
		}
	}
}

func TestStackTracesAndSQLKeepTheirAtSigns(t *testing.T) {
	b := New(&bytes.Buffer{})
	stack := "gripello/internal/x.go:12\n/go/pkg/mod/github.com/jackc/pgx/v5@v5.7.1/conn.go:98"
	slog.New(b).Warn("slow query", "sql", "SELECT 1 WHERE tags @> $1", "stack", stack)
	got := b.queue.take()[0]
	if got.Attrs["sql"] != "SELECT 1 WHERE tags @> $1" || got.Attrs["stack"] != stack {
		t.Fatalf("attrs = %+v", got.Attrs)
	}
}

func TestLinesLoggedWithTheRequestContextCarryItsID(t *testing.T) {
	var out bytes.Buffer
	b := New(&out)
	log := slog.New(b)
	var ctx context.Context
	httpx.WithRequestID(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { ctx = r.Context() })).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))

	log.ErrorContext(ctx, "moderation: mail failed")
	log.ErrorContext(ctx, "request failed", "req", "given")
	log.Error("without a context")

	got := b.queue.take()
	id := httpx.RequestID(ctx)
	if id == "" || got[0].Attrs["req"] != id || got[1].Attrs["req"] != "given" || got[2].Attrs != nil {
		t.Fatalf("entries = %+v", got)
	}
	if !strings.Contains(out.String(), "req="+id) || strings.Count(out.String(), "req=") != 2 {
		t.Errorf("stderr = %s", out.String())
	}
}

func TestGroupsNestAndOnlyPrefixLaterAttributes(t *testing.T) {
	b := New(&bytes.Buffer{})
	slog.New(b).With("module", "a").WithGroup("job").With("kind", "x").WithGroup("run").Info("done", "ms", 3)
	got := b.queue.take()[0].Attrs
	if len(got) != 3 || got["module"] != "a" || got["job.kind"] != "x" || got["job.run.ms"] != int64(3) {
		t.Fatalf("attrs = %+v", got)
	}
}
