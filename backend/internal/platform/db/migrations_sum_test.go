package db

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"testing"
)

const migrationsSum = "migrations.sum"

// Applied migrations never change: new files are appended with GRIPELLO_UPDATE_MIGRATIONS_SUM=1.
func TestMigrationsAreNeverEditedOnceListed(t *testing.T) {
	raw, err := os.ReadFile(migrationsSum)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	listed := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if hash, name, ok := strings.Cut(line, "  "); ok {
			listed[name] = hash
		}
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	var added []string
	for _, path := range names {
		content, _ := migrations.ReadFile(path)
		sum := sha256.Sum256(content)
		hash, name := hex.EncodeToString(sum[:]), strings.TrimPrefix(path, "migrations/")
		switch listed[name] {
		case hash:
		case "":
			added = append(added, fmt.Sprintf("%s  %s\n", hash, name))
		default:
			t.Errorf("%s changed after it was listed in %s; add a new migration instead", name, migrationsSum)
		}
	}
	if len(added) == 0 {
		return
	}
	if os.Getenv("GRIPELLO_UPDATE_MIGRATIONS_SUM") == "" {
		t.Fatalf("%s lacks %d migration(s); run the test with GRIPELLO_UPDATE_MIGRATIONS_SUM=1 to append them", migrationsSum, len(added))
	}
	file, err := os.OpenFile(migrationsSum, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	file.WriteString(strings.Join(added, ""))
}
