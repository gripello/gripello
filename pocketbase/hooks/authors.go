package hooks

import (
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const authorCacheTTL = time.Minute

type cachedAuthor struct {
	climber   climber
	anonymous bool
	expires   time.Time
}

// ponytail: per-process cache, entries of deleted or edited users are dropped by the users hooks
var authorCache = struct {
	sync.Mutex
	entries   map[string]cachedAuthor
	forgotten map[string]uint64
}{entries: map[string]cachedAuthor{}, forgotten: map[string]uint64{}}

func registerAuthorCache(app core.App) {
	forget := func(e *core.RecordEvent) error {
		authorCache.Lock()
		delete(authorCache.entries, e.Record.Id)
		authorCache.forgotten[e.Record.Id]++
		authorCache.Unlock()
		return e.Next()
	}
	app.OnRecordAfterUpdateSuccess("users").BindFunc(forget)
	app.OnRecordAfterDeleteSuccess("users").BindFunc(forget)
}

func authorOf(app core.App, userID string) (cachedAuthor, bool) {
	now := time.Now()
	authorCache.Lock()
	cached, ok := authorCache.entries[userID]
	generation := authorCache.forgotten[userID]
	authorCache.Unlock()
	if ok && now.Before(cached.expires) {
		return cached, true
	}
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		return cachedAuthor{}, false
	}
	cached = cachedAuthor{climber: climberOf(user), anonymous: user.GetBool("reviews_anonymous"), expires: now.Add(authorCacheTTL)}
	authorCache.Lock()
	defer authorCache.Unlock()
	if authorCache.forgotten[userID] != generation {
		return cached, true
	}
	for id, entry := range authorCache.entries {
		if now.After(entry.expires) {
			delete(authorCache.entries, id)
		}
	}
	authorCache.entries[userID] = cached
	return cached, true
}
