package ids

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

var valid = regexp.MustCompile(`^[a-z0-9]{15}$`)

// New returns a 15-char lowercase id, the shape every existing row id has.
func New() string {
	b := make([]byte, 15)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func Valid(id string) bool { return valid.MatchString(id) }

// Secret returns n random bytes as hex, for tokens handed out once and stored only as Hash.
func Secret(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Hash is the hex sha256 stored instead of a token.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
