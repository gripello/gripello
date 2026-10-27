package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPageCapsPageAndLimit(t *testing.T) {
	for query, want := range map[string]Paging{
		"/?page=9223372036854775807&limit=1000": {Page: MaxPage, Limit: 500},
		"/?page=0&limit=0":                      {Page: 1, Limit: 1},
		"/?page=x&limit=y":                      {Page: 1, Limit: 50},
		"/?page=3&limit=20":                     {Page: 3, Limit: 20},
	} {
		got := Page(httptest.NewRequest(http.MethodGet, query, nil), 50, 500)
		if got != want {
			t.Errorf("%s: %+v, want %+v", query, got, want)
		}
	}
	if tail := (Paging{Page: MaxPage, Limit: 500}).SQL(); tail != " LIMIT 500 OFFSET 499999500" {
		t.Errorf("tail %q", tail)
	}
}

func TestTooLongCountsRunes(t *testing.T) {
	if TooLong("name", "ääää", 4) != nil || TooLong("name", "ääääa", 4) == nil {
		t.Error("TooLong must count runes")
	}
}

func TestClientIPCompressesIPv6(t *testing.T) {
	for raw, want := range map[string]string{"0000:0000:0000:0000:0000:0000:0000:0001": "::1", "10.0.0.1": "10.0.0.1", "garbage": "garbage"} {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("X-Real-IP", raw)
		if got := ClientIP(r); got != want {
			t.Errorf("ClientIP(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestTruncate(t *testing.T) {
	if got := Truncate("äöü", 2); got != "äö" {
		t.Fatalf("Truncate() = %q", got)
	}
	if got := Truncate("ab", 5); got != "ab" {
		t.Fatalf("Truncate() = %q", got)
	}
}
