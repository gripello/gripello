package password

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/text/unicode/norm"
)

const (
	MinLength = 8
	cost      = 10
	// bcrypt only reads 72 bytes; hashing first lets any length count in full.
	prehashed = "sha256$"
)

func TooShort(password string) bool {
	return utf8.RuneCountInString(password) < MinLength
}

func Hash(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword(prehash(norm.NFC.String(password)), cost)
	if err != nil {
		return "", err
	}
	return prehashed + string(hash), nil
}

func Matches(hash, password string) bool {
	if rest, ok := strings.CutPrefix(hash, prehashed); ok {
		return bcrypt.CompareHashAndPassword([]byte(rest), prehash(norm.NFC.String(password))) == nil
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Legacy reports a plain bcrypt hash from before the sha256$ prefix; callers rehash it after a successful check.
func Legacy(hash string) bool {
	return hash != "" && !strings.HasPrefix(hash, prehashed)
}

func prehash(password string) []byte {
	sum := sha256.Sum256([]byte(password))
	return []byte(base64.StdEncoding.EncodeToString(sum[:]))
}
