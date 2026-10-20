package main

import (
	"context"
	"errors"
	"log/slog"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/db"
	"gripello/internal/platform/mail"
)

const punycodeLock = 7231002

var punycodeColumns = []struct{ table, column string }{
	{"users", "email"}, {"invites", "email"}, {"gym_onboardings", "email"}, {"reports", "notifier_email"},
}

// punycodeEmails rewrites addresses stored with a Unicode domain into the form mail.NormalizeAddress writes; drop it after one release.
func punycodeEmails(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, punycodeLock).Scan(&locked); err != nil || !locked {
		return err
	}
	defer conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, punycodeLock)
	for _, c := range punycodeColumns {
		if err := punycodeColumn(ctx, pool, c.table, c.column); err != nil {
			return err
		}
	}
	return punycodeBlocklists(ctx, pool)
}

func punycodeColumn(ctx context.Context, pool *pgxpool.Pool, table, column string) error {
	rows, err := pool.Query(ctx, `SELECT id, `+column+` FROM `+table+` WHERE `+column+` ~ '[^\x01-\x7f]'`)
	if err != nil {
		return err
	}
	type row struct{ ID, Address string }
	found, err := pgx.CollectRows(rows, pgx.RowToStructByPos[row])
	if err != nil {
		return err
	}
	for _, r := range found {
		address := mail.NormalizeAddress(r.Address)
		if address == r.Address {
			continue
		}
		if !mail.ValidAddress(address) {
			slog.Error("punycode: converted address is invalid, row left as is", "table", table, "id", r.ID)
			continue
		}
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE `+table+` SET `+column+` = $2 WHERE id = $1`, r.ID, address); err != nil || table != "users" {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE users SET updated = now() WHERE id = $1`, r.ID); err != nil {
				return err
			}
			record, err := climbers.OwnRecord(ctx, tx, r.ID)
			if err != nil {
				return err
			}
			return climbers.PublishUserUpdated(ctx, tx, "", r.ID, record, []string{"email"})
		})
		if db.IsUnique(err, "") {
			var taken []string
			pool.QueryRow(ctx, `SELECT array_agg(id) FROM `+table+` WHERE `+column+` = $1`, address).Scan(&taken)
			slog.Error("punycode: converted address is taken, row left as is", "table", table, "id", r.ID, "taken_by", taken)
			continue
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23514" {
			slog.Error("punycode: converted address violates a check, row left as is", "table", table, "id", r.ID, "constraint", pgErr.ConstraintName)
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func punycodeBlocklists(ctx context.Context, pool *pgxpool.Pool) error {
	var blocked, allowed []string
	err := pool.QueryRow(ctx, `SELECT blocked_emails, allowed_emails FROM platform_config
		WHERE array_to_string(blocked_emails || allowed_emails, ' ') ~ '[^\x01-\x7f]'`).Scan(&blocked, &allowed)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	fold := func(patterns []string) []string {
		out := make([]string, 0, len(patterns))
		for _, pattern := range patterns {
			if folded, ok := blocklist.NormalizeEmailPattern(pattern); ok {
				pattern = folded
			}
			out = append(out, pattern)
		}
		slices.Sort(out)
		return slices.Compact(out)
	}
	_, err = pool.Exec(ctx, `UPDATE platform_config SET blocked_emails = $1, allowed_emails = $2, updated = now()`, fold(blocked), fold(allowed))
	return err
}
