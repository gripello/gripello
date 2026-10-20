package mail

import (
	"net/mail"
	"strings"

	"golang.org/x/net/idna"
)

// MaxAddressLength is RFC 5321's limit for a forward path.
const MaxAddressLength = 254

// NormalizeAddress lowercases and writes the domain as ASCII (punycode), so müller.de and xn--mller-kva.de are one address.
func NormalizeAddress(address string) string {
	address = strings.ToLower(strings.TrimSpace(address))
	at := strings.LastIndexByte(address, '@')
	if at < 0 {
		return address
	}
	return address[:at+1] + ASCIIDomain(address[at+1:])
}

// ASCIIDomain converts each non-ASCII label to punycode; labels it can't convert (wildcards, invalid ones) stay as they are.
func ASCIIDomain(domain string) string {
	labels := strings.Split(domain, ".")
	for i, label := range labels {
		if isASCII(label) {
			continue
		}
		if ascii, err := idna.Lookup.ToASCII(label); err == nil {
			labels[i] = ascii
		}
	}
	return strings.Join(labels, ".")
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

func ValidAddress(address string) bool {
	if address == "" || len(address) > MaxAddressLength {
		return false
	}
	parsed, err := mail.ParseAddress(address)
	return err == nil && parsed.Address == address
}
