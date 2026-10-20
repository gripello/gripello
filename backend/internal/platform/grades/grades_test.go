package grades

import "testing"

func TestCanonicalFollowsEachSystemsConvention(t *testing.T) {
	for _, c := range []struct{ system, in, want string }{
		{"font", "6b+", "6B+"},
		{"font", " 7a ", "7A"},
		{"v", "v5", "V5"},
		{"french", "6B+", "6b+"},
		{"uiaa", "7-", "7-"},
	} {
		if got := Canonical(c.system, c.in); got != c.want {
			t.Errorf("Canonical(%q, %q) = %q, want %q", c.system, c.in, got, c.want)
		}
	}
}
