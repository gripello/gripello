package httpx

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Respond writes v unless err is set, which the Handler then turns into the error response.
func Respond(w http.ResponseWriter, status int, v any, err error) error {
	if err != nil {
		return err
	}
	JSON(w, status, v)
	return nil
}

func NoContent(w http.ResponseWriter, err error) error {
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func BadRequest(message string) *Error { return NewError(http.StatusBadRequest, message) }

func Invalid(field, message string) *Error {
	return BadRequest(message).Field(field, "validation_invalid_value", message)
}

func Required(field string) *Error {
	return BadRequest("Failed to save record.").Field(field, "validation_required", "Cannot be blank.")
}

// TooLong counts runes, like the clients' maxlength.
func TooLong(field, value string, limit int) error {
	if utf8.RuneCountInString(value) > limit {
		return Invalid(field, "Must be no more than "+strconv.Itoa(limit)+" characters.")
	}
	return nil
}

const maxPage = 1_000_000

type Paging struct {
	Page  int
	Limit int
}

// Page reads ?page= (1 to 1e6) and ?limit= (1 to maxLimit, def when absent or not a number).
func Page(r *http.Request, def, maxLimit int) Paging {
	query := r.URL.Query()
	return Paging{Page: min(maxPage, max(1, Atoi(query.Get("page"), 1))), Limit: min(maxLimit, max(1, Atoi(query.Get("limit"), def)))}
}

func (p Paging) SQL() string {
	return " LIMIT " + strconv.Itoa(p.Limit) + " OFFSET " + strconv.Itoa((p.Page-1)*p.Limit)
}

type PageOf[T any] struct {
	Items []T  `json:"items"`
	Page  int  `json:"page"`
	Limit int  `json:"limit"`
	Total *int `json:"total,omitempty"`
}

func Atoi(value string, fallback int) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return fallback
}

// ClientIP trusts X-Real-IP / X-Forwarded-For because nginx sets them in front of every replica.
func ClientIP(r *http.Request) string {
	raw := r.Header.Get("X-Real-IP")
	if raw == "" {
		raw, _, _ = strings.Cut(r.Header.Get("X-Forwarded-For"), ",")
	}
	if raw = strings.TrimSpace(raw); raw == "" {
		raw = r.RemoteAddr
		if host, _, err := net.SplitHostPort(raw); err == nil {
			raw = host
		}
	}
	if ip := net.ParseIP(raw); ip != nil {
		return ip.String()
	}
	return raw
}

func Truncate(s string, maxRunes int) string {
	if runes := []rune(s); len(runes) > maxRunes {
		return string(runes[:maxRunes])
	}
	return s
}
