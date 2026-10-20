package competitions

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/blocklist"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

func registrationOpen(c Competition, now time.Time) bool {
	return c.Status == "open" && now.Before(c.EndsAt)
}

func ownerEntryStatus(current, requested string, registrationOpen bool) string {
	switch {
	case requested == current:
		return current
	case requested == "withdrawn" && current != "disqualified":
		return requested
	case requested == "registered" && current == "withdrawn" && registrationOpen:
		return requested
	default:
		return current
	}
}

func needsGuardianConsent(birthYear, currentYear int) bool {
	return currentYear-birthYear < guardianConsentAge
}

func categoryFits(c Category, birthYear int) bool {
	return (c.MinBirthYear == 0 || birthYear >= c.MinBirthYear) && (c.MaxBirthYear == 0 || birthYear <= c.MaxBirthYear)
}

func checkEntryName(ctx context.Context, q db.Querier, name string) error {
	if protected, err := blocklist.NameProtected(ctx, q, name); err != nil {
		return err
	} else if protected {
		return httpx.BadRequest("This name is reserved.").Field("display_name", blocklist.CodeNameProtected, "This name is reserved.")
	}
	return nil
}

func validateEntry(ctx context.Context, q db.Querier, e Entry, currentYear int, enforceCategoryAge bool) error {
	if httpx.Blank(e.DisplayName) {
		return httpx.Required("display_name")
	}
	if err := httpx.TooLong("display_name", e.DisplayName, 60); err != nil {
		return err
	}
	if !slices.Contains(entryStatuses, e.Status) {
		return httpx.Invalid("status", "Invalid status.")
	}
	if e.Bib < 0 {
		return httpx.Invalid("bib", "Must be at least 1.")
	}
	if e.BirthYear < currentYear-120 || e.BirthYear > currentYear {
		return httpx.Invalid("birth_year", "Invalid birth year.")
	}
	if needsGuardianConsent(e.BirthYear, currentYear) && !e.GuardianConsent {
		return httpx.Invalid("guardian_consent", "Participants under 16 need a guardian's consent.")
	}
	category, err := findCategory(ctx, q, e.Category)
	if err != nil || category.Competition != e.Competition {
		return httpx.Invalid("category", "Category is not part of this competition.")
	}
	if enforceCategoryAge && !categoryFits(category, e.BirthYear) {
		return httpx.Invalid("birth_year", "Your birth year does not fit this category.")
	}
	return nil
}

func (m *module) createEntry(ctx context.Context, competitionID string, raw json.RawMessage) (Entry, error) {
	p, err := auth.Require(ctx)
	if err != nil {
		return Entry{}, err
	}
	c, v, err := m.loadVisible(ctx, competitionID)
	if err != nil {
		return Entry{}, err
	}
	now := time.Now()
	e := Entry{Status: "registered"}
	if err := unmarshalBody(raw, &e); err != nil {
		return Entry{}, err
	}
	e.ID, e.Competition, e.Expand = ids.New(), c.ID, nil
	if !v.manager {
		if !registrationOpen(c, now) {
			return Entry{}, httpx.BadRequest("Registration is closed.")
		}
		e.User, e.Status, e.Paid, e.Bib = p.UserID, "registered", false, 0
	}
	if e.User == "" {
		e.User = p.UserID
	}
	if err := validateEntry(ctx, m.app.DB, e, now.Year(), !v.manager); err != nil {
		return Entry{}, err
	}
	if !v.manager {
		if err := checkEntryName(ctx, m.app.DB, e.DisplayName); err != nil {
			return Entry{}, err
		}
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if c, err = lockCompetition(ctx, tx, c.ID, "NO KEY UPDATE"); err != nil {
			return err
		}
		if !v.manager && !registrationOpen(c, now) {
			return httpx.BadRequest("Registration is closed.")
		}
		if e.Bib == 0 {
			if e.Bib, err = nextBib(ctx, tx, c.ID); err != nil {
				return err
			}
		}
		if err := saveEntry(ctx, tx, e, true); err != nil {
			return err
		}
		if e, err = findEntry(ctx, tx, e.ID); err != nil {
			return err
		}
		if err := publishEntryCreated(ctx, tx, e, c.Gym); err != nil {
			return err
		}
		if e.User != p.UserID {
			if err := events.PublishNotify(ctx, tx, auth.UserID(ctx), events.Notify{Type: "competition_entry_added", Users: []string{e.User}, Gym: c.Gym,
				Params: map[string]any{"competition": c.Name}, URL: tenancy.GymPath(ctx, tx, c.Gym, "/competitions/"+c.ID)}); err != nil {
				return err
			}
		}
		return publishChange(ctx, tx, c, "entries", e.User, e.ID)
	})
	return e, entryConflict(err)
}

func entryConflict(err error) error {
	switch {
	case db.IsUnique(err, "competition_entries_user_idx"):
		return httpx.Invalid("user", "Already registered for this competition.")
	case db.IsUnique(err, "competition_entries_bib_idx"):
		return httpx.Invalid("bib", "This bib is already taken.")
	case db.IsFKViolation(err):
		return httpx.Invalid("user", "User not found.")
	}
	return err
}

func (m *module) loadOwnedEntry(ctx context.Context, id string) (Entry, Competition, viewer, error) {
	p, err := auth.Require(ctx)
	if err != nil {
		return Entry{}, Competition{}, viewer{}, err
	}
	e, err := findEntry(ctx, m.app.DB, id)
	if err != nil {
		return e, Competition{}, viewer{}, err
	}
	c, err := findVisibleCompetition(ctx, m.app.DB, e.Competition)
	if err != nil {
		return e, c, viewer{}, err
	}
	v := m.viewerFor(ctx, c)
	if !v.manager && e.User != p.UserID {
		if v.staff || (c.Status != "draft" && !e.Hidden) {
			return e, c, v, httpx.ErrForbidden
		}
		return e, c, v, httpx.ErrNotFound
	}
	return e, c, v, nil
}

func (m *module) updateEntry(ctx context.Context, id string, raw json.RawMessage) (Entry, error) {
	_, c, v, err := m.loadOwnedEntry(ctx, id)
	if err != nil {
		return Entry{}, err
	}
	var e Entry
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		before, err := m.lockEntry(ctx, tx, &c, id)
		if err != nil {
			return err
		}
		e = before
		if err := unmarshalBody(raw, &e); err != nil {
			return err
		}
		now := time.Now()
		if !v.manager {
			open := registrationOpen(c, now)
			e.Competition, e.User, e.Bib, e.Paid = before.Competition, before.User, before.Bib, before.Paid
			e.Status = ownerEntryStatus(before.Status, e.Status, open)
			if e.Category != before.Category && !open {
				return httpx.Invalid("category", "Categories can only change while registration is open.")
			}
		}
		if e.Competition != before.Competition {
			return errMoved
		}
		if e.User != before.User {
			return httpx.Invalid("user", "This field can't be changed.")
		}
		e.ID, e.Expand = before.ID, nil
		if err := validateEntry(ctx, tx, e, now.Year(), !v.manager); err != nil {
			return err
		}
		if !v.manager && e.DisplayName != before.DisplayName {
			if err := checkEntryName(ctx, tx, e.DisplayName); err != nil {
				return err
			}
		}
		if e.DisplayName != before.DisplayName || e.Hidden != before.Hidden {
			if err := refuseWhileHidden(ctx, tx, "competition_entry", id); err != nil {
				return err
			}
		}
		if err := saveEntry(ctx, tx, e, false); err != nil {
			return err
		}
		if e, err = findEntry(ctx, tx, id); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "entries", e.User, e.ID)
	})
	return e, entryConflict(err)
}

// lockEntry locks the competition before the entry, the order every competition write follows.
func (m *module) lockEntry(ctx context.Context, tx pgx.Tx, c *Competition, id string) (Entry, error) {
	var err error
	if *c, err = lockCompetition(ctx, tx, c.ID, "SHARE"); err != nil {
		return Entry{}, err
	}
	return db.One[Entry](ctx, tx, `SELECT `+entryColumns+` FROM competition_entries WHERE id = $1 FOR UPDATE`, id)
}

func (m *module) deleteEntry(ctx context.Context, id string) error {
	_, c, v, err := m.loadOwnedEntry(ctx, id)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		e, err := m.lockEntry(ctx, tx, &c, id)
		if err != nil {
			return err
		}
		if !v.manager {
			var scored bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM competition_scores WHERE entry = $1)`, id).Scan(&scored); err != nil {
				return err
			}
			if scored || e.Status == "disqualified" {
				return httpx.NewError(http.StatusForbidden, "This entry can no longer be deleted; withdraw instead.")
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM competition_entries WHERE id = $1`, id); err != nil {
			return err
		}
		if err := publishEntryDeleted(ctx, tx, e, c.Gym); err != nil {
			return err
		}
		return publishChange(ctx, tx, c, "entries", e.User, e.ID)
	})
}
