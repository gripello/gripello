package blocklist

import (
	"slices"
	"testing"
)

func TestMatchEmail(t *testing.T) {
	patterns := []string{"bad@example.com", "spam.test", "*.trash.test", "*@relay.test"}
	for email, want := range map[string]bool{
		"bad@example.com":    true,
		" BAD@Example.com ":  true,
		"good@example.com":   false,
		"x@spam.test":        true,
		"x@sub.spam.test":    false,
		"x@a.trash.test":     true,
		"x@trash.test":       false,
		"x@relay.test":       true,
		"x@notspam.test":     false,
		"bad@example.com.ru": false,
	} {
		if got := MatchEmail(patterns, email); got != want {
			t.Errorf("MatchEmail(%q) = %v, want %v", email, got, want)
		}
	}
}

func TestNormalizeEmailPattern(t *testing.T) {
	for pattern, want := range map[string]bool{
		" Spam.Test ": true, "*.spam.test": true, "a@b.test": true, "*@x.test": true,
		"": false, "*": false, "*@*": false, "a b@x.test": false, "a@b@c": false, "[a@x.test": false,
	} {
		if _, ok := NormalizeEmailPattern(pattern); ok != want {
			t.Errorf("NormalizeEmailPattern(%q) ok = %v, want %v", pattern, ok, want)
		}
	}
}

func TestMatchName(t *testing.T) {
	terms := []string{"gripello", "admin"}
	gyms := []string{"Max Boulder", "max-boulder", "Kletterhalle"}
	for name, want := range map[string]bool{
		"Gr1pello_Team":    true,
		"A d m i n":        true,
		"Grípello":         true,
		"max boulder":      true,
		"MaxBoulder":       true,
		"Max":              false,
		"Maxine":           false,
		"Kletterhalle":     true,
		"Kletterhalle Fan": false,
		"Lena Climber":     false,
		"":                 false,
	} {
		if got := MatchName(terms, gyms, name); got != want {
			t.Errorf("MatchName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestDomainAndParents(t *testing.T) {
	if got := DomainAndParents(" X@A.b.Example.com "); !slices.Equal(got, []string{"a.b.example.com", "b.example.com", "example.com"}) {
		t.Errorf("DomainAndParents = %v", got)
	}
	if got := DomainAndParents("x@localhost"); len(got) != 0 {
		t.Errorf("single label = %v", got)
	}
}

func TestMatchesNameTheRule(t *testing.T) {
	if got := EmailMatch([]string{"bad@example.com", "spam.test"}, "X@Spam.test"); got != "spam.test" {
		t.Errorf("EmailMatch = %q", got)
	}
	if got := NameMatch([]string{"Gripello"}, []string{"North Walls"}, "north-walls"); got != "North Walls" {
		t.Errorf("NameMatch gym = %q", got)
	}
	if got := NameMatch([]string{"Gripello"}, nil, "gr1pello fan"); got != "Gripello" {
		t.Errorf("NameMatch term = %q", got)
	}
}
