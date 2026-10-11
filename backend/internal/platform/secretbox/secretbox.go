// Package secretbox seals settings secrets (SMTP password, OAuth client secrets) at rest with a key derived from the token secret.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

var ErrUnreadable = errors.New("secretbox: sealed with another secret or corrupted")

func aead(secret string) (cipher.AEAD, error) {
	key := sha256.Sum256([]byte("gripello-secretbox:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal returns base64(nonce|ciphertext); an empty plain text stays empty so "not set" survives a round trip.
func Seal(secret, plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	gcm, err := aead(secret)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	rand.Read(nonce)
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func Open(secret, sealed string) (string, error) {
	if sealed == "" {
		return "", nil
	}
	gcm, err := aead(secret)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", ErrUnreadable
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", ErrUnreadable
	}
	return string(plain), nil
}
