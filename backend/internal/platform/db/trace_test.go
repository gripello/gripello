package db

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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gripello/internal/platform/httpx"
)

func TestExpectedQueryErrorsAreNotLogged(t *testing.T) {
	for _, err := range []error{
		pgx.ErrNoRows,
		context.Canceled,
		fmt.Errorf("load: %w", context.DeadlineExceeded),
		&pgconn.PgError{Code: "23505"},
		&pgconn.PgError{Code: "57014"},
	} {
		if !expectedQueryError(err) {
			t.Errorf("%v is logged as a failed query", err)
		}
	}
	for _, err := range []error{&pgconn.PgError{Code: "42P01"}, &pgconn.PgError{Code: "40001"}, errors.New("conn closed")} {
		if expectedQueryError(err) {
			t.Errorf("%v is hidden", err)
		}
	}
}

func TestEveryQueryIsNotedForTheRequest(t *testing.T) {
	var ctx context.Context
	httpx.WithRequestID(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { ctx = r.Context() })).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	logs := &bytes.Buffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	tracer{}.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "SELECT 1"})
	server := httpx.Observe(func(context.Context) string { return "" })(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		httpx.Fail(w, errors.New("boom"))
	}))
	server.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil).WithContext(ctx))
	if !strings.Contains(logs.String(), `last_sql="SELECT 1"`) {
		t.Errorf("log = %s", logs.String())
	}
}
