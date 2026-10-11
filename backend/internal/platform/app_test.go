package platform

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"gripello/internal/platform/config"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/realtime"
)

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

func TestServeDrainsInFlightRequestsAndEndsStreams(t *testing.T) {
	app := &App{Cfg: config.Config{HTTPAddr: freeAddr(t)}, Mux: http.NewServeMux(), Realtime: realtime.NewHub(events.NewBus(nil), nil)}
	entered, finished := make(chan struct{}), make(chan struct{})
	app.Handle("GET /slow", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		time.Sleep(300 * time.Millisecond)
		io.WriteString(w, "done")
		close(finished)
	}))
	app.Handle("GET /realtime", httpx.Handler(app.Realtime.Connect))

	ctx, cancel := context.WithCancel(context.Background())
	served := make(chan error, 1)
	go func() { served <- app.Serve(ctx) }()
	base := "http://" + app.Cfg.HTTPAddr + "/api"
	var stream *http.Response
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(20 * time.Millisecond) {
		var err error
		if stream, err = http.Get(base + "/realtime"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(err)
		}
	}
	defer stream.Body.Close()

	type result struct {
		body string
		err  error
	}
	slow := make(chan result, 1)
	go func() {
		resp, err := http.Get(base + "/slow")
		if err != nil {
			slow <- result{err: err}
			return
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		slow <- result{string(body), err}
	}()
	<-entered
	cancel()

	select {
	case err := <-served:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(shutdownTimeout):
		t.Fatal("Serve did not return: the open stream kept the server busy")
	}
	select {
	case <-finished:
	default:
		t.Fatal("Serve returned before the in-flight request finished")
	}
	if got := <-slow; got.err != nil || got.body != "done" {
		t.Fatalf("in-flight request = %q, %v", got.body, got.err)
	}
}
