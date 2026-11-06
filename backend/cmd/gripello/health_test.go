package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"gripello/internal/platform/testapp"
)

type fakePinger struct{ err error }

func (p fakePinger) Ping(context.Context) error { return p.err }

func TestHealthReportsTheDatabase(t *testing.T) {
	cases := []struct {
		name     string
		db       pinger
		code     int
		status   string
		database string
	}{
		{"healthy", fakePinger{}, 200, "ok", "ok"},
		{"database down", fakePinger{errors.New("refused")}, 503, "unavailable", "down"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			healthHandler(c.db).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if rec.Code != c.code || body["status"] != c.status || body["database"] != c.database || body["version"] == "" {
				t.Fatalf("got %d %v", rec.Code, body)
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("health must not be cached")
			}
		})
	}
}

func TestLivenessAnswersWithoutTheDatabase(t *testing.T) {
	rec := httptest.NewRecorder()
	livenessHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/livez", nil))
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("got %d, Cache-Control %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	_, ops, err := testapp.Contract()
	if err != nil {
		t.Fatal(err)
	}
	if err := testapp.CheckResponse(ops[testapp.RouteKey("GET", "/livez")], rec.Code, "application/json", rec.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
}
