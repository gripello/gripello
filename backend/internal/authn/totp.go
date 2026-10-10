package authn

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	totpAlgorithm   = "SHA1"
	totpDigits      = 6
	totpPeriod      = 30
	totpSecretBytes = 20
)

var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func newTOTPSecret() string {
	secret := make([]byte, totpSecretBytes)
	_, _ = rand.Read(secret)
	return totpEncoding.EncodeToString(secret)
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	key, err := totpEncoding.DecodeString(strings.ToUpper(strings.TrimRight(strings.ReplaceAll(secret, " ", ""), "=")))
	if err != nil {
		return nil, err
	}
	if len(key) < 16 {
		return nil, fmt.Errorf("secret too short")
	}
	return key, nil
}

func totpCode(key []byte, step int64, digits int) string {
	message := make([]byte, 8)
	binary.BigEndian.PutUint64(message, uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(message)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	modulo := uint32(1)
	for range digits {
		modulo *= 10
	}
	return fmt.Sprintf("%0*d", digits, value%modulo)
}

func matchTOTP(key []byte, code string, now time.Time, lastStep int64) int64 {
	code = strings.ReplaceAll(code, " ", "")
	if len(code) != totpDigits {
		return 0
	}
	current := now.Unix() / totpPeriod
	for _, step := range []int64{current - 1, current, current + 1} {
		if step > lastStep && subtle.ConstantTimeCompare([]byte(totpCode(key, step, totpDigits)), []byte(code)) == 1 {
			return step
		}
	}
	return 0
}

func totpURI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	query := url.Values{
		"secret":    {secret},
		"issuer":    {issuer},
		"algorithm": {totpAlgorithm},
		"digits":    {fmt.Sprint(totpDigits)},
		"period":    {fmt.Sprint(totpPeriod)},
	}
	return "otpauth://totp/" + label + "?" + query.Encode()
}
