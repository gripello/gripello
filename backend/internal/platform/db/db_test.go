package db

import (
	"slices"
	"testing"
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
