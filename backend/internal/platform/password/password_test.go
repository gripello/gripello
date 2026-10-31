package password

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestLongPasswordsCountInFull(t *testing.T) {
	long := strings.Repeat("ü", 200)
	hash, err := Hash(long)
	if err != nil {
		t.Fatal(err)
	}
	if !Matches(hash, long) {
		t.Fatal("the password should match its own hash")
	}
	if Matches(hash, long[:len(long)-2]+"x") {
		t.Fatal("a change past byte 72 must not match")
	}
}

func TestLegacyBcryptHashesStillMatch(t *testing.T) {
	legacy, _ := bcrypt.GenerateFromPassword([]byte("SecurePass1!"), bcrypt.MinCost)
	if !Matches(string(legacy), "SecurePass1!") || Matches(string(legacy), "wrong-pass") {
		t.Fatal("legacy hashes must keep verifying")
	}
}

func TestTooShortCountsCharacters(t *testing.T) {
	if !TooShort("üüüü") || TooShort("üüüüüüüü") {
		t.Fatal("the minimum counts characters, not bytes")
	}
}

func TestComposedAndDecomposedTypingMatch(t *testing.T) {
	composed, decomposed := "KlätterSpäß1", "KlätterSpäß1"
	for _, typed := range []string{composed, decomposed} {
		hash, err := Hash(typed)
		if err != nil {
			t.Fatal(err)
		}
		if !Matches(hash, composed) || !Matches(hash, decomposed) {
			t.Fatalf("hash of %q must match both spellings", typed)
		}
	}
	legacy, _ := bcrypt.GenerateFromPassword([]byte(decomposed), bcrypt.MinCost)
	if Matches(string(legacy), composed) || !Matches(string(legacy), decomposed) {
		t.Fatal("legacy bcrypt hashes compare the raw bytes")
	}
}

func TestLegacyTellsPlainBcryptFromPrefixedHashes(t *testing.T) {
	legacy, _ := bcrypt.GenerateFromPassword([]byte("SecurePass1!"), bcrypt.MinCost)
	current, _ := Hash("SecurePass1!")
	if !Legacy(string(legacy)) || Legacy(current) || Legacy("") {
		t.Fatal("only plain bcrypt hashes are legacy")
	}
}

func TestLoadtestSeedUsesThePrefixedHash(t *testing.T) {
	seed, err := os.ReadFile("../../../../loadtest/seed.sql")
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`\\set password_hash '([^']+)'`).FindSubmatch(seed)
	if match == nil {
		t.Fatal("seed.sql sets no default password_hash")
	}
	hash := string(match[1])
	if Legacy(hash) || !Matches(hash, "loadtest-password") {
		t.Fatalf("seed.sql default hash %q is not a sha256$ hash of loadtest-password", hash)
	}
}
