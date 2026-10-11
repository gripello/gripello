package secretbox

import (
	"errors"
	"strings"
	"testing"
)

func TestSealRoundTripsAndNeedsTheSameSecret(t *testing.T) {
	sealed, err := Seal("one", "hunter2")
	if err != nil || sealed == "" || strings.Contains(sealed, "hunter2") {
		t.Fatalf("sealed = %q, %v", sealed, err)
	}
	if plain, err := Open("one", sealed); err != nil || plain != "hunter2" {
		t.Errorf("open = %q, %v", plain, err)
	}
	if again, _ := Seal("one", "hunter2"); again == sealed {
		t.Error("two seals of the same text are identical; the nonce is not random")
	}
	if _, err := Open("two", sealed); !errors.Is(err, ErrUnreadable) {
		t.Errorf("open with another secret = %v", err)
	}
	if _, err := Open("one", "not base64!"); !errors.Is(err, ErrUnreadable) {
		t.Errorf("garbage = %v", err)
	}
	if sealed, _ := Seal("one", ""); sealed != "" {
		t.Errorf("empty sealed to %q", sealed)
	}
}
