package main

import (
	"context"
	"net/http"
	"time"

	"gripello/internal/platform/config"
	"gripello/internal/platform/httpx"
)

const healthPingTimeout = 2 * time.Second

type pinger interface {
	Ping(ctx context.Context) error
}

func healthHandler(db pinger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), healthPingTimeout)
		defer cancel()
		status, database, code := "ok", "ok", http.StatusOK
		if err := db.Ping(ctx); err != nil {
			status, database, code = "unavailable", "down", http.StatusServiceUnavailable
		}
		w.Header().Set("Cache-Control", "no-store")
		httpx.JSON(w, code, map[string]string{"version": config.Version, "status": status, "database": database})
	})
}
