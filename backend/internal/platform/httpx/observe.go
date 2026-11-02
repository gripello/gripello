package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"time"
)

// SlowRequest is the duration above which a request is logged at WARN; 0 disables it.
var SlowRequest = 2 * time.Second

// Streams and downloads take as long as the connection and the test mail as long as the SMTP server, so their duration is no sign of a slow server.
var streaming = map[string]bool{
	"GET /api/realtime":                  true,
	"GET /api/files/{table}/{id}/{name}": true,
	"GET /api/me/export":                 true,
	"GET /api/platform/backups/{name}":   true,
	"POST /api/platform/mail/test":       true,
}

type requestIDKey struct{}

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// WithRequestID takes nginx's X-Request-Id (or makes one), echoes it and puts it into the context, where logbuf adds it to every *Context log line.
func WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if !validRequestID.MatchString(id) {
			b := make([]byte, 8)
			rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), requestIDKey{}, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, lastQueryKey{}, new(atomic.Pointer[string]))))
	})
}

func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

type lastQueryKey struct{}

// NoteQuery remembers the request's latest SQL, so a failed request names the query it most likely failed on
// (errors such as "no rows in result set" arrive without it).
func NoteQuery(ctx context.Context, sql string) {
	if last, ok := ctx.Value(lastQueryKey{}).(*atomic.Pointer[string]); ok {
		last.Store(&sql)
	}
}

// CompactSQL puts a statement on one line and cuts it at 500 bytes for logging.
func CompactSQL(sql string) string {
	sql = strings.Join(strings.Fields(sql), " ")
	if len(sql) > 500 {
		sql = strings.ToValidUTF8(sql[:500], "") + "…"
	}
	return sql
}

type observedWriter struct {
	http.ResponseWriter
	status  int
	failure error
	codes   []string
}

func (w *observedWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *observedWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *observedWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *observedWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func observed(w http.ResponseWriter) *observedWriter {
	for {
		switch v := w.(type) {
		case *observedWriter:
			return v
		case interface{ Unwrap() http.ResponseWriter }:
			w = v.Unwrap()
		default:
			return nil
		}
	}
}

// Observe must wrap the mux (it fills r.Pattern) inside the metrics middleware, so a recovered panic counts as a 500; it never logs URL, query, IP or e-mail.
func Observe(user func(context.Context) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ow := &observedWriter{ResponseWriter: w}
			defer func() {
				panicked := recover()
				if panicked == http.ErrAbortHandler {
					panic(panicked)
				}
				if panicked != nil && ow.status == 0 {
					JSON(ow, http.StatusInternalServerError, NewError(http.StatusInternalServerError, "Something went wrong."))
				}
				status := ow.status
				if status == 0 {
					status = http.StatusOK
				}
				took := time.Since(start)
				attrs := []any{"req", RequestID(r.Context()), "method", r.Method, "route", r.Pattern, "status", status,
					"ms", took.Milliseconds(), "user", user(r.Context())}
				switch {
				case panicked != nil:
					slog.ErrorContext(r.Context(), "request panicked", append(attrs, "panic", fmt.Sprint(panicked), "stack", string(debug.Stack()))...)
				case ow.failure != nil:
					if last, ok := r.Context().Value(lastQueryKey{}).(*atomic.Pointer[string]); ok && last.Load() != nil {
						attrs = append(attrs, "last_sql", CompactSQL(*last.Load()))
					}
					slog.ErrorContext(r.Context(), "request failed", append(attrs, "error", ow.failure)...)
				case status >= 500:
					slog.WarnContext(r.Context(), "server error response", attrs...)
				case SlowRequest > 0 && took > SlowRequest && !streaming[r.Pattern]:
					slog.WarnContext(r.Context(), "slow request", attrs...)
				case status >= 400:
					slog.DebugContext(r.Context(), "request rejected", append(attrs, "codes", ow.codes)...)
				}
			}()
			next.ServeHTTP(ow, r)
		})
	}
}
