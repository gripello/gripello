package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseSemver(t *testing.T) {
	for _, c := range []struct {
		in                  string
		major, minor, patch int
		ok                  bool
	}{
		{"", 0, 0, 0, false},
		{"dev", 0, 0, 0, false},
		{"v1.5.0", 1, 5, 0, true},
		{"1.5.0-3-gabc", 1, 5, 0, true},
		{"12.34.56", 12, 34, 56, true},
	} {
		major, minor, patch, ok := ParseSemver(c.in)
		if major != c.major || minor != c.minor || patch != c.patch || ok != c.ok {
			t.Errorf("ParseSemver(%q) = %d.%d.%d %v", c.in, major, minor, patch, ok)
		}
	}
}

func TestCheck(t *testing.T) {
	for _, c := range []struct {
		client, server string
		want           Outcome
	}{
		{"", "1.5.0", OK},
		{"dev", "1.5.0", OK},
		{"1.5.0", "dev", OK},
		{"1.6.0", "", OK},
		{"1.5.0", "1.5.0", OK},
		{"v1.5.0", "1.5.0-3-gabc", OK},
		{"1.4.9", "1.5.0", Outdated},
		{"1.5.0", "1.5.1", Outdated},
		{"1.5.2", "1.5.1", Outdated},
		{"1.6.0", "1.5.0", Unsupported},
		{"2.0.0", "1.5.0", Unsupported},
		{"0.9.0", "1.5.0", Unsupported},
	} {
		if got := Check(c.client, c.server); got != c.want {
			t.Errorf("Check(%q, %q) = %d, want %d", c.client, c.server, got, c.want)
		}
	}
}

func TestVersioned(t *testing.T) {
	handler := Versioned("1.5.0")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	serve := func(client string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/x", nil)
		if client != "" {
			req.Header.Set(VersionHeader, client)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Header().Get(VersionHeader) != "1.5.0" {
			t.Errorf("client %q: response version header %q", client, rec.Header().Get(VersionHeader))
		}
		return rec
	}
	if rec := serve(""); rec.Code != http.StatusNoContent {
		t.Errorf("no header: status %d", rec.Code)
	}
	if rec := serve("1.4.0"); rec.Code != http.StatusNoContent {
		t.Errorf("outdated client: status %d", rec.Code)
	}
	rec := serve("2.0.0")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unsupported_version") || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Errorf("unsupported client: %d %s %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
}
