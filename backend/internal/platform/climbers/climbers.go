package climbers

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const cacheTTL = time.Minute

// Climber is how other people see a user: full name (username fallback), the "First L." short form for boards, and the avatar thumb.
type Climber struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Short  string `json:"-"`
	Avatar string `json:"avatar"`
}

type entry struct {
	climber Climber
	expires time.Time
}

// ponytail: per-replica cache; modules call Forget on the user.updated event every replica sees, the TTL covers the rest.
type Lookup struct {
	pool      *pgxpool.Pool
	mu        sync.Mutex
	entries   map[string]entry
	forgotten map[string]uint64
}

func New(pool *pgxpool.Pool) *Lookup {
	return &Lookup{pool: pool, entries: map[string]entry{}, forgotten: map[string]uint64{}}
}

func (l *Lookup) Forget(id string) {
	l.mu.Lock()
	delete(l.entries, id)
	l.forgotten[id]++
	l.mu.Unlock()
}

// Get returns the climbers that exist among ids; an edit that lands during the query is not cached.
func (l *Lookup) Get(ctx context.Context, ids []string) (map[string]Climber, error) {
	now := time.Now()
	found := map[string]Climber{}
	var missing []string
	generations := map[string]uint64{}
	l.mu.Lock()
	for _, id := range ids {
		if e, ok := l.entries[id]; ok && now.Before(e.expires) {
			found[id] = e.climber
		} else if _, seen := generations[id]; !seen && id != "" {
			missing = append(missing, id)
			generations[id] = l.forgotten[id]
		}
	}
	l.mu.Unlock()
	if len(missing) == 0 {
		return found, nil
	}
	rows, err := l.pool.Query(ctx, `SELECT id, username, firstname, name, avatar FROM users WHERE id = ANY ($1)`, missing)
	if err != nil {
		return nil, err
	}
	loaded, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Climber, error) {
		var c Climber
		var username, firstname, name, avatar string
		err := row.Scan(&c.ID, &username, &firstname, &name, &avatar)
		c.Name, c.Short, c.Avatar = FullName(username, firstname, name), ShortName(username, firstname, name), AvatarURL(c.ID, avatar)
		return c, err
	})
	if err != nil {
		return nil, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	for id, e := range l.entries {
		if now.After(e.expires) {
			delete(l.entries, id)
		}
	}
	for _, c := range loaded {
		found[c.ID] = c
		if l.forgotten[c.ID] == generations[c.ID] {
			l.entries[c.ID] = entry{climber: c, expires: now.Add(cacheTTL)}
		}
	}
	return found, nil
}

func FullName(username, firstname, name string) string {
	full := strings.TrimSpace(strings.TrimSpace(firstname) + " " + strings.TrimSpace(name))
	if full == "" {
		return username
	}
	return full
}

// ShortName is "First L."; a climber without a name shows the username.
func ShortName(username, firstname, name string) string {
	words := strings.Fields(firstname + " " + name)
	switch len(words) {
	case 0:
		return username
	case 1:
		return words[0]
	}
	return words[0] + " " + string([]rune(words[len(words)-1])[0]) + "."
}

func AvatarURL(userID, file string) string {
	if file == "" {
		return ""
	}
	return "/api/files/users/" + userID + "/" + file + "?thumb=100x100"
}
