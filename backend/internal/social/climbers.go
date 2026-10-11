package social

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/httpx"
)

const (
	climberSearchLimit = 20
	climberLookupLimit = 200
	searchWords        = 3
	minSearchLength    = 3
)

// visibleTo is: yourself, an open/approve profile, or someone you follow (accepted) or who follows you (any status) — never a blocker of the viewer.
const visibleTo = `NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker = u.id AND b.blocked = $1)
	AND (u.id = $1 OR u.follow_policy <> 'closed' OR EXISTS (SELECT 1 FROM follows f
		WHERE (f.follower = $1 AND f.followee = u.id AND f.status = 'accepted') OR (f.followee = $1 AND f.follower = u.id)))`

type ProfileFollow struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type Climber struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Banner string `json:"banner"`
}

const climberColumns = `u.id, u.username, u.firstname, u.name, u.avatar, u.banner`

func scanClimber(row pgx.Row, extra ...any) (Climber, error) {
	var c Climber
	var username, firstname, name, avatar, banner string
	err := row.Scan(append([]any{&c.ID, &username, &firstname, &name, &avatar, &banner}, extra...)...)
	c.Name = person{username: username, firstname: firstname, name: name}.fullName()
	c.Avatar = climbers.AvatarURL(c.ID, avatar)
	if banner != "" {
		c.Banner = "/api/files/users/" + c.ID + "/" + banner + "?thumb=1600x400"
	}
	return c, err
}

type Profile struct {
	Climber
	Closed       bool           `json:"closed"`
	Private      bool           `json:"private"`
	Followers    int            `json:"followers"`
	Following    int            `json:"following"`
	Follow       *ProfileFollow `json:"follow"`
	SendsVisible bool           `json:"sends_visible"`
}

func likePattern(word string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(word) + "%"
}

func (m *module) listClimbers(w http.ResponseWriter, r *http.Request) error {
	principal, _ := auth.From(r.Context())
	query := r.URL.Query()
	sql := `SELECT ` + climberColumns + ` FROM users u WHERE ` + visibleTo
	args := []any{principal.UserID}
	if term := strings.TrimSpace(query.Get("q")); term != "" {
		if len([]rune(term)) < minSearchLength {
			httpx.JSON(w, http.StatusOK, []Climber{})
			return nil
		}
		if err := m.searches.Check(w, principal.UserID); err != nil {
			return err
		}
		sql += ` AND u.id <> $1 AND u.follow_policy <> 'closed'`
		words := strings.Fields(term)
		for _, word := range words[:min(len(words), searchWords)] {
			args = append(args, likePattern(word))
			n := strconv.Itoa(len(args))
			sql += ` AND (u.firstname ILIKE $` + n + ` OR u.name ILIKE $` + n + ` OR u.username ILIKE $` + n + `)`
		}
		sql += ` ORDER BY lower(u.firstname), lower(u.name), u.id LIMIT ` + strconv.Itoa(climberSearchLimit)
	} else {
		requested := strings.Split(query.Get("ids"), ",")
		args = append(args, requested[:min(len(requested), climberLookupLimit)])
		sql += ` AND u.id = ANY ($2)`
	}
	rows, err := m.app.DB.Query(r.Context(), sql, args...)
	if err != nil {
		return err
	}
	found, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Climber, error) { return scanClimber(row) })
	if err != nil {
		return err
	}
	if found == nil {
		found = []Climber{}
	}
	httpx.JSON(w, http.StatusOK, found)
	return nil
}

func (m *module) getClimber(w http.ResponseWriter, r *http.Request) error {
	principal, _ := auth.From(r.Context())
	var p Profile
	var policy string
	var err error
	p.Climber, err = scanClimber(m.app.DB.QueryRow(r.Context(), `SELECT `+climberColumns+`, u.follow_policy, u.ticks_private,
			(SELECT count(*) FROM follows WHERE followee = u.id AND status = 'accepted'),
			(SELECT count(*) FROM follows WHERE follower = u.id AND status = 'accepted')
		FROM users u WHERE u.id = $2 AND `+visibleTo, principal.UserID, r.PathValue("id")), &policy, &p.Private, &p.Followers, &p.Following)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.ErrNotFound
	}
	if err != nil {
		return err
	}
	p.Closed = policy == "closed"
	if p.ID == principal.UserID {
		p.SendsVisible = true
	} else {
		follow, err := findFollow(r.Context(), m.app.DB, `SELECT `+followColumns+` FROM follows WHERE follower = $1 AND followee = $2`, principal.UserID, p.ID)
		if err == nil {
			p.Follow = &ProfileFollow{ID: follow.ID, Status: follow.Status}
			p.SendsVisible = follow.Status == "accepted" && !p.Private
		} else if !errors.Is(err, httpx.ErrNotFound) {
			return err
		}
	}
	httpx.JSON(w, http.StatusOK, p)
	return nil
}
