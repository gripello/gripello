package db

import (
	"slices"
	"strings"
	"testing"
)

func TestWordPatterns(t *testing.T) {
	if got := WordPatterns("  Tilo  Alexander "); !slices.Equal(got, []string{"%Tilo%", "%Alexander%"}) {
		t.Errorf("words = %q", got)
	}
	if got := WordPatterns(`50%_a\b`); !slices.Equal(got, []string{`%50\%\_a\\b%`}) {
		t.Errorf("escaped = %q", got)
	}
	if got := WordPatterns(strings.Repeat("a ", 1000)); len(got) != maxSearchWords {
		t.Errorf("long term = %d patterns, want %d", len(got), maxSearchWords)
	}
	if got := WordPatterns(" "); got == nil || len(got) != 0 {
		t.Errorf("blank = %#v, want an empty non-nil slice", got)
	}
}
