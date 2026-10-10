package moderation

import (
	"slices"
	"testing"

	"gripello/internal/platform/blob"
)

func TestHideableFilesNeverGetTheImmutableCache(t *testing.T) {
	for name, k := range kinds {
		if len(k.files) > 0 && !slices.Contains(blob.ProtectedTables, k.table) && !slices.Contains(blob.ModeratedTables, k.table) {
			t.Errorf("kind %s keeps files in %s; add it to blob.ModeratedTables", name, k.table)
		}
	}
}
