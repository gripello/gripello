package httpx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func captureLogs(t *testing.T) *bytes.Buffer {
	var out bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &out
}

func observedServer(routes map[string]http.HandlerFunc) http.Handler {
	mux := http.NewServeMux()
	for pattern, h := range routes {
		mux.Handle(pattern, h)
	}
	return WithRequestID(Observe(func(context.Context) string { return "user-1" })(mux))
}

func TestFailedRequestsAreLoggedWithRouteUserAndRequestID(t *testing.T) {
	logs := captureLogs(t)
	server := observedServer(map[string]http.HandlerFunc{
		"GET /api/routes/{id}": func(w http.ResponseWriter, r *http.Request) { Fail(w, errors.New("db down")) },
	})
	req := httptest.NewRequest("GET", "/api/routes/abc?email=ada@example.com", nil)
	req.Header.Set("X-Request-Id", "nginx-req-1")
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, req)
	line := logs.String()
	if rec.Code != 500 || rec.Header().Get("X-Request-Id") != "nginx-req-1" {
		t.Fatalf("status %d, request id %q", rec.Code, rec.Header().Get("X-Request-Id"))
	}
	for _, want := range []string{"level=ERROR", `msg="request failed"`, "req=nginx-req-1", `route="GET /api/routes/{id}"`, "user=user-1", `error="db down"`} {
		if !strings.Contains(line, want) {
			t.Errorf("log lacks %s: %s", want, line)
		}
	}
	if strings.Contains(line, "ada@example.com") || strings.Contains(line, "/api/routes/abc") || strings.Contains(line, "stack=") {
		t.Errorf("the raw URL or a stack taken after the handler returned reached the log: %s", line)
	}
}

func TestPanicsBecomeLogged500s(t *testing.T) {
	logs := captureLogs(t)
	server := observedServer(map[string]http.HandlerFunc{
		"GET /boom": func(w http.ResponseWriter, r *http.Request) { panic("nil map") },
	})
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, httptest.NewRequest("GET", "/boom", nil))
	if rec.Code != 500 || !strings.Contains(rec.Body.String(), "Something went wrong.") {
		t.Fatalf("panic answered %d %s", rec.Code, rec.Body)
	}
	if line := logs.String(); !strings.Contains(line, `msg="request panicked"`) || !strings.Contains(line, `panic="nil map"`) || !strings.Contains(line, "observe_test.go") {
		t.Errorf("panic log = %s", line)
	}
	if id := rec.Header().Get("X-Request-Id"); len(id) != 16 {
		t.Errorf("generated request id = %q", id)
	}
}

func TestRejectedRequestsLogTheirFieldCodesAtDebug(t *testing.T) {
	logs := captureLogs(t)
	server := observedServer(map[string]http.HandlerFunc{
		"POST /form": func(w http.ResponseWriter, r *http.Request) {
			Fail(w, NewError(400, "bad").Field("email", "invalid_email", "Invalid."))
		},
	})
	req := httptest.NewRequest("POST", "/form", nil)
	req.Header.Set("X-Request-Id", "bad id with spaces")
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, req)
	line := logs.String()
	if !strings.Contains(line, "level=DEBUG") || !strings.Contains(line, "codes=[invalid_email]") || strings.Contains(line, "bad id") {
		t.Errorf("rejected log = %s", line)
	}
}

func TestClientAbortsAreLoggedAtDebugNot500(t *testing.T) {
	logs := captureLogs(t)
	server := observedServer(map[string]http.HandlerFunc{
		"GET /api/routes": func(w http.ResponseWriter, r *http.Request) {
			Fail(w, fmt.Errorf("list routes: %w", context.Canceled))
		},
	})
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, httptest.NewRequest("GET", "/api/routes", nil))
	line := logs.String()
	if rec.Code != 499 || strings.Contains(line, "level=ERROR") || !strings.Contains(line, `level=DEBUG msg="request rejected"`) {
		t.Errorf("abort answered %d, log = %s", rec.Code, line)
	}
}
