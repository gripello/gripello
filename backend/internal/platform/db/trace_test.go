package db

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
