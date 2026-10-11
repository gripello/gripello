package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
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
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// Fail writes err as JSON; unknown errors become a 500 without leaking their text.
func Fail(w http.ResponseWriter, err error) {
	var e *Error
	if errors.Is(err, ErrUnauthorized) {
		e = NewError(http.StatusUnauthorized, "The request requires valid record authorization token.")
	} else if errors.Is(err, ErrForbidden) {
		e = NewError(http.StatusForbidden, "You are not allowed to perform this request.")
	} else if errors.Is(err, ErrNotFound) {
		e = NewError(http.StatusNotFound, "The requested resource wasn't found.")
	} else if !errors.As(err, &e) {
		slog.Error("request failed", "error", err)
		e = NewError(http.StatusInternalServerError, "Something went wrong.")
	}
	JSON(w, e.Status, e)
}

// Handler lets handlers return errors instead of writing them.
type Handler func(w http.ResponseWriter, r *http.Request) error

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		Fail(w, err)
	}
}

func Decode(r *http.Request, v any) error {
	if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20)).Decode(v); err != nil {
		return NewError(http.StatusBadRequest, "Invalid JSON body.")
	}
	return nil
}
