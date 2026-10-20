package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"
	"unicode"

	"gripello/internal/platform/apitime"
)

// Error is the JSON shape the frontend already maps onto forms: {status, message, data: {field: {code, message}}}.
type Error struct {
	Status  int                   `json:"status"`
	Message string                `json:"message"`
	Data    map[string]FieldError `json:"data"`
}

type FieldError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return e.Message }

// Sentinels handlers may return directly; Fail maps them to the right status.
var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrNotFound     = errors.New("not found")
)

func NewError(status int, message string) *Error {
	return &Error{Status: status, Message: message, Data: map[string]FieldError{}}
}

func (e *Error) Field(name, code, message string) *Error {
	e.Data[name] = FieldError{Code: code, Message: message}
	return e
}

func JSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		Fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(append(apitime.Canonical(body), '\n'))
}

// Fail writes err as JSON; unknown errors become a 500 without leaking their text.
func Fail(w http.ResponseWriter, err error) {
	var e *Error
	if errors.Is(err, context.Canceled) {
		e = NewError(499, "Client closed request.")
	} else if errors.Is(err, ErrUnauthorized) {
		e = NewError(http.StatusUnauthorized, "The request requires valid record authorization token.")
	} else if errors.Is(err, ErrForbidden) {
		e = NewError(http.StatusForbidden, "You are not allowed to perform this request.")
	} else if errors.Is(err, ErrNotFound) {
		e = NewError(http.StatusNotFound, "The requested resource wasn't found.")
	} else if !errors.As(err, &e) {
		if ow := observed(w); ow != nil {
			ow.failure = err
		} else {
			slog.Error("request failed", "error", err)
		}
		e = NewError(http.StatusInternalServerError, "Something went wrong.")
	}
	if ow := observed(w); ow != nil {
		for _, f := range e.Data {
			ow.codes = append(ow.codes, f.Code)
		}
	}
	JSON(w, e.Status, e)
}

// Handler lets handlers return errors instead of writing them.
type Handler func(w http.ResponseWriter, r *http.Request) error

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.ContainsRune(r.URL.Path, 0) || strings.ContainsRune(r.URL.RawQuery, 0) || strings.Contains(r.URL.RawQuery, "%00") {
		Fail(w, errNUL)
		return
	}
	if err := h(w, r); err != nil {
		Fail(w, err)
	}
}

var errNUL = NewError(http.StatusBadRequest, "Text must not contain NUL characters.")

// CheckForm refuses a parsed multipart form whose fields hold NUL, raw or escaped in a JSON payload, like Decode does.
func CheckForm(r *http.Request) error {
	if r.MultipartForm == nil {
		return nil
	}
	for key, values := range r.MultipartForm.Value {
		for _, value := range append(values, key) {
			if strings.ContainsRune(value, 0) || escapesNUL([]byte(value)) {
				return errNUL
			}
		}
	}
	return nil
}

func Decode(r *http.Request, v any) error {
	raw, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err != nil || json.NewDecoder(bytes.NewReader(raw)).Decode(v) != nil {
		return NewError(http.StatusBadRequest, "Invalid JSON body.")
	}
	if escapesNUL(raw) {
		return errNUL
	}
	return nil
}

// ReadBody accepts JSON or multipart: one file per part named in fileTypes, the other fields as JSON in `@jsonPayload`.
func ReadBody(w http.ResponseWriter, r *http.Request, maxBytes int64, fileTypes map[string][]string) (map[string]json.RawMessage, map[string]*multipart.FileHeader, error) {
	body := map[string]json.RawMessage{}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		return body, nil, Decode(r, &body)
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		return nil, nil, BadRequest("Invalid multipart body.")
	}
	if err := CheckForm(r); err != nil {
		return nil, nil, err
	}
	if payload := r.FormValue("@jsonPayload"); payload != "" {
		if err := json.Unmarshal([]byte(payload), &body); err != nil {
			return nil, nil, BadRequest("Invalid JSON body.")
		}
	}
	files := map[string]*multipart.FileHeader{}
	for name, headers := range r.MultipartForm.File {
		if _, ok := fileTypes[name]; ok && len(headers) > 0 {
			files[name] = headers[0]
		}
	}
	return body, files, nil
}

// Postgres text can't hold U+0000, and JSON can only carry it escaped.
func escapesNUL(raw []byte) bool {
	for i := bytes.Index(raw, []byte(`\u0000`)); i >= 0; {
		backslashes := 0
		for j := i - 1; j >= 0 && raw[j] == '\\'; j-- {
			backslashes++
		}
		if backslashes%2 == 0 {
			return true
		}
		next := bytes.Index(raw[i+1:], []byte(`\u0000`))
		if next < 0 {
			return false
		}
		i += 1 + next
	}
	return false
}

// Blank reports text that renders as nothing: whitespace, zero-width and other format or control characters.
func Blank(s string) bool {
	return strings.TrimFunc(s, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.In(r, unicode.Cf, unicode.Cc) || r == '\u3164' || r == '\u2800'
	}) == ""
}
