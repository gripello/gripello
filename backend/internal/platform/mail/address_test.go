package mail

import (
	"strings"
	"testing"
)

func TestValidAddress(t *testing.T) {
	long := strings.Repeat("a", MaxAddressLength-len("@x.de")) + "@x.de"
	for address, want := range map[string]bool{
		"cleo@example.com": true, long: true, long + "x": false, "": false, "Cleo <cleo@example.com>": false, "no-at": false,
	} {
		if got := ValidAddress(address); got != want {
			t.Errorf("ValidAddress(%q) = %v", address, got)
		}
	}
	if got := NormalizeAddress("  Cleo@Example.COM "); got != "cleo@example.com" {
		t.Errorf("NormalizeAddress = %q", got)
	}
}

func TestNormalizeAddressWritesDomainsAsPunycode(t *testing.T) {
	for in, want := range map[string]string{
		"Info@Müller.DE":        "info@xn--mller-kva.de",
		"info@xn--mller-kva.de": "info@xn--mller-kva.de",
		"jörg@example.com":      "jörg@example.com",
		"no-at":                 "no-at",
		"a@sub.bücher.example":  "a@sub.xn--bcher-kva.example",
	} {
		if got := NormalizeAddress(in); got != want {
			t.Errorf("NormalizeAddress(%q) = %q, want %q", in, got, want)
		}
	}
	if !ValidAddress(NormalizeAddress("Info@Müller.de")) {
		t.Error("a normalized IDN address must stay valid")
	}
}
