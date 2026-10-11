package ids

import "testing"

func TestNewIsValidAndUnique(t *testing.T) {
	seen := map[string]bool{}
	for range 1000 {
		id := New()
		if !Valid(id) || seen[id] {
			t.Fatalf("bad id %q", id)
		}
		seen[id] = true
	}
	if Valid("TooShort") || Valid("abcdefghijklmnop") {
		t.Fatal("accepted invalid id")
	}
}
