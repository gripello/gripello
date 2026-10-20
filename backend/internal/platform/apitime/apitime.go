// Package apitime is the one wire format for time: timestamps as RFC 3339 in UTC with milliseconds, days as YYYY-MM-DD.
package apitime

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	Layout     = "2006-01-02T15:04:05.000Z"
	DateLayout = time.DateOnly
)

var ErrFormat = errors.New("apitime: not an RFC 3339 timestamp or YYYY-MM-DD day")

var (
	rfc3339 = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$`)
)

func Format(t time.Time) string { return string(appendLayout(make([]byte, 0, len(Layout)), t)) }

// appendLayout writes Layout by hand: Canonical runs over every response, and time.AppendFormat dominated it.
func appendLayout(b []byte, t time.Time) []byte {
	t = t.UTC()
	year, month, day := t.Date()
	digits := func(b []byte, n, width int) []byte {
		for i := width - 1; i >= 0; i-- {
			b = append(b, 0)
		}
		for i := len(b) - 1; i >= len(b)-width; i-- {
			b[i] = byte('0' + n%10)
			n /= 10
		}
		return b
	}
	b = digits(b, year, 4)
	b = append(b, '-')
	b = digits(b, int(month), 2)
	b = append(b, '-')
	b = digits(b, day, 2)
	b = append(b, 'T')
	b = digits(b, t.Hour(), 2)
	b = append(b, ':')
	b = digits(b, t.Minute(), 2)
	b = append(b, ':')
	b = digits(b, t.Second(), 2)
	b = append(b, '.')
	b = digits(b, t.Nanosecond()/1e6, 3)
	return append(b, 'Z')
}

func Parse(s string) (time.Time, error) {
	if !rfc3339.MatchString(s) {
		return time.Time{}, ErrFormat
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}, ErrFormat
	}
	return t, nil
}

// Canonical rewrites timestamp strings in encoded JSON to Layout, whether Go's encoder or Postgres' to_jsonb wrote
// them; only values of timestamp keys (TimestampKey) count, so user text that happens to look like one stays as typed.
func Canonical(body []byte) []byte {
	var out []byte
	copied := 0
	for i := 0; ; {
		next := bytes.IndexByte(body[i:], '"')
		if next < 0 {
			break
		}
		start := i + next + 1
		i = start
		if !stampPrefix(body[start:]) {
			continue
		}
		end := bytes.IndexByte(body[start:min(len(body), start+maxStampLength+1)], '"')
		if end < 0 {
			continue
		}
		stamp := body[start : start+end]
		i = start + end + 1
		if canonical(stamp) || !TimestampKey(keyBefore(body, start-1)) {
			continue
		}
		t, err := time.Parse(time.RFC3339Nano, string(stamp))
		if err != nil {
			continue
		}
		if out == nil {
			out = make([]byte, 0, len(body))
		}
		out = appendLayout(append(out, body[copied:start]...), t)
		copied = start + end
	}
	if out == nil {
		return body
	}
	return append(out, body[copied:]...)
}

var timestampKeys = map[string]bool{"created": true, "updated": true, "started": true, "now": true, "oldest": true, "t": true, "at": true,
	"time": true, "date": true, "bucket": true, "slot": true, "tstamp": true, "from": true, "to": true, "until": true, "window_start": true,
	"run_after": true, "first_seen": true, "last_seen": true, "last_used": true, "last_run": true, "last_tick": true}

// TimestampKey tells whether a JSON key carries a timestamp: the column and field names above plus *_at, *At, *_until, *Date.
func TimestampKey(key string) bool {
	return timestampKeys[key] || strings.HasSuffix(key, "_at") || strings.HasSuffix(key, "At") || strings.HasSuffix(key, "_until") ||
		strings.HasSuffix(key, "Date") || strings.HasSuffix(key, "_date")
}

// keyBefore returns the object key whose value opens at quote, or "" for array items and the top level.
func keyBefore(body []byte, quote int) string {
	i := quote - 1
	for i >= 0 && isSpace(body[i]) {
		i--
	}
	if i < 0 || body[i] != ':' {
		return ""
	}
	i--
	for i >= 0 && isSpace(body[i]) {
		i--
	}
	if i < 0 || body[i] != '"' {
		return ""
	}
	open := bytes.LastIndexByte(body[:i], '"')
	if open < 0 {
		return ""
	}
	return string(body[open+1 : i])
}

func isSpace(c byte) bool { return c == ' ' || c == '\n' || c == '\t' || c == '\r' }

const maxStampLength = len("2006-01-02T15:04:05.999999999+00:00")

func canonical(stamp []byte) bool {
	return len(stamp) == len(Layout) && stamp[19] == '.' && stamp[23] == 'Z'
}

// stampPrefix matches "dddd-dd-ddTdd:dd:dd", the part every RFC 3339 timestamp starts with.
func stampPrefix(b []byte) bool {
	const shape = "dddd-dd-ddTdd:dd:dd"
	if len(b) < len(shape) {
		return false
	}
	for i := range len(shape) {
		if shape[i] == 'd' {
			if b[i] < '0' || b[i] > '9' {
				return false
			}
		} else if b[i] != shape[i] {
			return false
		}
	}
	return true
}

// Date is a calendar day; it scans from and writes to SQL date columns and travels as YYYY-MM-DD.
type Date string

func ParseDate(s string) (Date, error) {
	t, err := time.Parse(DateLayout, s)
	if err != nil || t.Format(DateLayout) != s {
		return "", ErrFormat
	}
	return Date(s), nil
}

func DateOf(t time.Time) Date { return Date(t.UTC().Format(DateLayout)) }

func (d Date) Time() time.Time {
	t, _ := time.Parse(DateLayout, string(d))
	return t
}

func (d *Date) UnmarshalJSON(raw []byte) error {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return ErrFormat
	}
	parsed, err := ParseDate(s)
	*d = parsed
	return err
}

func (d *Date) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*d = ""
	case time.Time:
		*d = Date(v.Format(DateLayout))
	case string:
		*d = Date(v)
	default:
		return fmt.Errorf("apitime: cannot scan %T into a Date", src)
	}
	return nil
}

func (d Date) Value() (driver.Value, error) {
	if d == "" {
		return nil, nil
	}
	return string(d), nil
}

// ParseTimeOrDay reads range filters, where a bare day means its start in UTC.
func ParseTimeOrDay(s string) (time.Time, error) {
	if day, err := ParseDate(s); err == nil {
		return day.Time(), nil
	}
	return Parse(s)
}
