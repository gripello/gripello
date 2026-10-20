package competitions

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

func acceptsScores(c Competition, now time.Time) bool {
	return c.Status == "open" && !now.Before(c.StartsAt) && !now.After(c.EndsAt)
}

func normalizeScore(s *Score, r CompRoute, c Competition) {
	if c.Discipline == "rope" {
		normalizeRopeScore(s, r.HoldCount, c.ScoringFormat)
		return
	}
	s.Style, s.Height, s.HeightPlus = "", 0, false
	zone := s.ZoneAttempt
	if !r.Zone {
		zone = 0
	} else if s.TopAttempt > 0 && (zone == 0 || zone > s.TopAttempt) {
		zone = s.TopAttempt
	}
	s.ZoneAttempt = zone
	s.Attempts = max(s.Attempts, s.TopAttempt, zone)
}

func normalizeRopeScore(s *Score, holdCount int, format string) {
	s.ZoneAttempt = 0
	if format == judgeOnlyFormat {
		height := max(s.Height, 0)
		if holdCount > 0 {
			height = min(height, holdCount)
		}
		topped := holdCount > 0 && height == holdCount
		s.Style, s.Height, s.HeightPlus, s.TopAttempt, s.Attempts = "lead", height, s.HeightPlus && !topped, 0, 1
		if topped {
			s.TopAttempt = 1
		}
		return
	}
	if s.Style != "toprope" {
		s.Style = "lead"
	}
	s.Height, s.HeightPlus = 0, false
	s.Attempts = max(s.Attempts, s.TopAttempt)
}

func validateScoreNumbers(s Score) error {
	for field, value := range map[string]int{"attempts": s.Attempts, "zone_attempt": s.ZoneAttempt, "top_attempt": s.TopAttempt, "height": s.Height} {
		if value < 0 || value > 999 {
			return httpx.Invalid(field, "Must be between 0 and 999.")
		}
	}
	if !slices.Contains([]string{"", "lead", "toprope"}, s.Style) {
		return httpx.Invalid("style", "Invalid style.")
	}
	return nil
}

// Judges may still correct a closed competition; published results are already in the logbooks.
func scoringOpen(c Competition) bool { return c.Status == "open" || c.Status == "closed" }

// guardScore: entry and route must share the competition; climbers score only their own
// active entry, on open competitions inside the window, never voided routes or judge-only formats.
func guardScore(s *Score, e Entry, r CompRoute, c Competition, v viewer, now time.Time) error {
	if e.Competition != c.ID {
		return httpx.Invalid("entry", "Entry not found.")
	}
	if r.Competition != c.ID {
		return httpx.Invalid("comp_route", "Route is not part of this competition.")
	}
	if v.staff && !scoringOpen(c) {
		return httpx.BadRequest("Scoring is closed.")
	}
	if !v.staff {
		if e.User != v.user {
			return httpx.ErrForbidden
		}
		if c.ScoringFormat == judgeOnlyFormat {
			return httpx.NewError(http.StatusForbidden, "Only judges can enter scores in this competition.")
		}
		if !acceptsScores(c, now) {
			return httpx.BadRequest("Scoring is closed.")
		}
		if slices.Contains(inactiveEntryStatuses, e.Status) {
			return httpx.NewError(http.StatusForbidden, "This entry can no longer score.")
		}
		if r.Voided {
			return httpx.BadRequest("This route was removed from scoring.")
		}
	}
	if err := validateScoreNumbers(*s); err != nil {
		return err
	}
	s.Competition = c.ID
	normalizeScore(s, r, c)
	return nil
}

func (m *module) upsertScores(ctx context.Context, competitionID string, inputs []Score) ([]Score, error) {
	if _, err := auth.Require(ctx); err != nil {
		return nil, err
	}
	c, err := findVisibleCompetition(ctx, m.app.DB, competitionID)
	if err != nil {
		return nil, err
	}
	v := m.viewerFor(ctx, c)
	now := time.Now()
	saved := []Score{}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if c, err = lockCompetition(ctx, tx, c.ID, "SHARE"); err != nil {
			return err
		}
		entries := map[string]bool{}
		for _, s := range inputs {
			e, err := findEntry(ctx, tx, s.Entry)
			if err != nil {
				return httpx.Invalid("entry", "Entry not found.")
			}
			r, err := findCompRoute(ctx, tx, s.CompRoute)
			if err != nil {
				return httpx.Invalid("comp_route", "Route is not part of this competition.")
			}
			if err := guardScore(&s, e, r, c, v, now); err != nil {
				return err
			}
			s.ID, s.ScoredBy, s.ByJudge = ids.New(), &v.user, v.staff
			stored, err := upsertScore(ctx, tx, s)
			if errors.Is(err, httpx.ErrNotFound) {
				return httpx.NewError(http.StatusForbidden, "A judge already scored this route.")
			}
			if err != nil {
				return err
			}
			saved = append(saved, stored)
			entries[e.ID] = true
		}
		for entry := range entries {
			if err := publishChange(ctx, tx, c, "scores", "", entry); err != nil {
				return err
			}
		}
		return nil
	})
	return saved, err
}

func (m *module) deleteScore(ctx context.Context, id string) error {
	s, err := findScore(ctx, m.app.DB, id)
	if err != nil {
		return err
	}
	c, err := m.loadManaged(ctx, s.Competition)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if c, err = lockCompetition(ctx, tx, c.ID, "SHARE"); err != nil {
			return err
		}
		if !scoringOpen(c) {
			return httpx.BadRequest("Scoring is closed.")
		}
		if _, err := tx.Exec(ctx, `DELETE FROM competition_scores WHERE id = $1`, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "scores", "", s.Entry)
	})
}
