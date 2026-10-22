package db

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestCommandEnvKeepsTheTLSMode(t *testing.T) {
	for url, want := range map[string]string{
		"postgres://u:p@db:5432/g?sslmode=disable":     "PGSSLMODE=disable",
		"postgres://u:p@db:5432/g?sslmode=verify-full": "PGSSLMODE=verify-full",
		"postgres://u:p@db:5432/g?sslmode=require":     "PGSSLMODE=require",
	} {
		env, err := CommandEnv(url)
		if err != nil || !slices.Contains(env, want) || !slices.Contains(env, "PGPASSWORD=p") {
			t.Errorf("%s: %v %v", url, env, err)
		}
	}
}

func TestConnectWaitRetriesUntilTheContextEnds(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	pool, err := ConnectWait(ctx, "postgres://u:p@127.0.0.1:1/g?sslmode=disable&connect_timeout=1", 50*time.Millisecond)
	if pool != nil || err == nil || time.Since(start) < 250*time.Millisecond {
		t.Fatalf("pool %v, err %v after %v", pool, err, time.Since(start))
	}
}

func TestConnectWaitFailsAtOnceOnABadURL(t *testing.T) {
	if _, err := ConnectWait(context.Background(), "postgres://%zz", time.Hour); err == nil {
		t.Fatal("expected a parse error")
	}
}

func TestConnectWaitGivesUpOnlyOnPermanentErrors(t *testing.T) {
	for code, want := range map[string]bool{"28P01": false, "28000": false, "3D000": false, "57P03": true, "57P01": true} {
		if got := retryable(fmt.Errorf("connect: %w", &pgconn.PgError{Code: code})); got != want {
			t.Errorf("%s: retryable = %v", code, got)
		}
	}
	if !retryable(errors.New("lookup postgres: no such host")) {
		t.Error("network errors must be retried")
	}
}
