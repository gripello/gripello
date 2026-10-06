package hooks

import (
	"testing"
)

func TestAuthorChangedDuringLookupIsNotCached(t *testing.T) {
	f := newMemberFixture(t)
	defer f.app.Cleanup()
	authorCache.Lock()
	delete(authorCache.entries, f.climber.Id)
	authorCache.forgotten[f.climber.Id] = 0
	authorCache.Unlock()

	if _, ok := authorOf(f.app, f.climber.Id); !ok {
		t.Fatal("author lookup failed")
	}
	f.climber.Set("reviews_anonymous", true)
	if err := f.app.Save(f.climber); err != nil {
		t.Fatal(err)
	}
	if author, _ := authorOf(f.app, f.climber.Id); !author.anonymous {
		t.Error("an edited author was served from the cache")
	}
}
