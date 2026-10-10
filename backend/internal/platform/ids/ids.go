package ids

import (
	"crypto/rand"
	"regexp"
)

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

var valid = regexp.MustCompile(`^[a-z0-9]{15}$`)

// New returns a 15-char lowercase id, the shape PocketBase used, so old and new ids are indistinguishable.
func New() string {
	b := make([]byte, 15)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func Valid(id string) bool { return valid.MatchString(id) }
