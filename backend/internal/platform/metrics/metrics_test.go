package metrics

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gripello/internal/platform/testkit"
)

func TestRecordedRequestsAddUpAcrossReplicas(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/gyms/{gym}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("gym") == "broken" {
			w.WriteHeader(http.StatusInternalServerError)
		}
	})
	first, second := New(pool), New(pool)
	for _, path := range []string{"/api/gyms/north", "/api/gyms/broken", "/api/nope"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-Real-IP", "203.0.113.7")
		first.Middleware(mux).ServeHTTP(httptest.NewRecorder(), req)
	}
	second.Record("GET", "GET /api/gyms/{gym}", http.StatusNotFound, 30*time.Millisecond, "198.51.100.1")
	second.Record("GET", "GET /api/realtime", http.StatusOK, 10*time.Minute, "203.0.113.7")
	second.Record("GET", "GET /api/health", http.StatusOK, time.Millisecond, "192.0.2.50")
	second.Record("GET", "GET /api/livez", http.StatusOK, time.Millisecond, "192.0.2.50")
	second.Record("GET", "GET /api/settings", http.StatusOK, time.Millisecond, "127.0.0.1")
	for _, rec := range []*Recorder{first, second} {
		if err := rec.Flush(ctx); err != nil {
			t.Fatal(err)
		}
	}

	var total, client, server, samples int64
	if err := pool.QueryRow(ctx, `SELECT total, client_errors, server_errors, b0+b1+b2+b3+b4+b5+b6+b7+b8+b9+b10 FROM request_stats WHERE method = 'GET' AND pattern = '/api/gyms/{gym}'`).
		Scan(&total, &client, &server, &samples); err != nil {
		t.Fatal(err)
	}
	if total != 3 || client != 1 || server != 1 || samples != 3 {
		t.Errorf("gym endpoint = total %d, 4xx %d, 5xx %d, samples %d", total, client, server, samples)
	}
	var unmatched, streamSamples int64
	pool.QueryRow(ctx, `SELECT total FROM request_stats WHERE pattern = 'unmatched'`).Scan(&unmatched)
	pool.QueryRow(ctx, `SELECT b0+b1+b2+b3+b4+b5+b6+b7+b8+b9+b10 FROM request_stats WHERE pattern = '/api/realtime'`).Scan(&streamSamples)
	var probes int
	pool.QueryRow(ctx, `SELECT count(*) FROM request_stats WHERE pattern IN ('/api/health', '/api/livez')`).Scan(&probes)
	if probes != 0 {
		t.Errorf("probe rows = %d, want 0", probes)
	}
	if unmatched != 1 || streamSamples != 0 {
		t.Errorf("unmatched = %d, realtime latency samples = %d", unmatched, streamSamples)
	}
	var visitors int
	pool.QueryRow(ctx, `SELECT count(*) FROM request_visitors`).Scan(&visitors)
	if visitors != 2 {
		t.Errorf("visitors = %d, want 2 (one IP seen by both replicas, no probe or loopback)", visitors)
	}

	pool.Exec(ctx, `INSERT INTO visitor_salts (day, salt) VALUES ('2020-01-01', 'old')`)
	if err := Prune(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var salts int
	pool.QueryRow(ctx, `SELECT count(*) FROM visitor_salts`).Scan(&salts)
	if salts != 1 {
		t.Errorf("salts after prune = %d, want only today's", salts)
	}
}

func TestAFailedFlushKeepsTheCounts(t *testing.T) {
	pool := testkit.Pool(t)
	pool.Exec(context.Background(), `ALTER TABLE request_stats RENAME TO request_stats_away`)
	rec := New(pool)
	rec.Record("GET", "GET /api/gyms", http.StatusOK, time.Millisecond, "203.0.113.7")
	if err := rec.Flush(context.Background()); err == nil {
		t.Fatal("flush without the request_stats table succeeded")
	}
	pool.Exec(context.Background(), `ALTER TABLE request_stats_away RENAME TO request_stats`)
	if err := rec.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	var total int
	pool.QueryRow(context.Background(), `SELECT total FROM request_stats WHERE pattern = '/api/gyms'`).Scan(&total)
	if total != 1 {
		t.Errorf("total after retry = %d, want 1", total)
	}
}

func TestUsageCountsPeopleOnceAcrossReplicasAndForgetsThem(t *testing.T) {
	pool := testkit.Pool(t)
	ctx := context.Background()
	first, second := New(pool), New(pool)
	first.Use("POST /api/me/ticks", http.StatusCreated, "alice", "203.0.113.7", Client{UserAgent: appUA})
	first.Use("POST /api/me/ticks", http.StatusCreated, "alice", "203.0.113.7", Client{UserAgent: appUA})
	second.Use("POST /api/me/ticks", http.StatusCreated, "alice", "198.51.100.1", Client{UserAgent: appUA})
	second.Use("POST /api/me/ticks", http.StatusCreated, "bob", "198.51.100.2", Client{UserAgent: appUA})
	second.Use("GET /api/routes/{id}", http.StatusOK, "", "198.51.100.3", Client{UserAgent: desktopUA})
	second.Use("GET /api/routes/{id}", http.StatusOK, "", "127.0.0.1", Client{UserAgent: desktopUA})
	second.Use("GET /api/routes/{id}", http.StatusNotFound, "", "198.51.100.4", Client{UserAgent: desktopUA})
	second.Use("GET /api/settings", http.StatusOK, "", "198.51.100.3", Client{UserAgent: desktopUA})
	for _, rec := range []*Recorder{first, second} {
		if err := rec.Flush(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var hashes int
	pool.QueryRow(ctx, `SELECT count(*) FROM usage_people`).Scan(&hashes)
	if hashes != 3 {
		t.Errorf("people hashes = %d, want 3 (alice once, bob, one guest; no loopback)", hashes)
	}
	pool.Exec(ctx, `UPDATE usage_daily SET day = day - 1`)
	pool.Exec(ctx, `UPDATE usage_people SET day = day - 1`)
	pool.Exec(ctx, `INSERT INTO visitor_salts (day, salt) VALUES (current_date - 1, 'yesterday') ON CONFLICT DO NOTHING`)
	if err := RollupUsage(ctx, pool); err != nil {
		t.Fatal(err)
	}
	usage := map[string][2]int64{}
	rows, _ := pool.Query(ctx, `SELECT feature, signed_in, app, device, os, requests, people FROM usage_daily`)
	for rows.Next() {
		var feature, device, os string
		var signedIn, app bool
		var requests, people int64
		rows.Scan(&feature, &signedIn, &app, &device, &os, &requests, &people)
		usage[fmt.Sprintf("%s %t %t %s %s", feature, signedIn, app, device, os)] = [2]int64{requests, people}
	}
	rows.Close()
	want := map[string][2]int64{"logbook.log true true phone android": {4, 2}, "routes.detail false false desktop windows": {2, 1}}
	if !maps.Equal(usage, want) {
		t.Errorf("usage = %v, want %v", usage, want)
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM usage_people`).Scan(&hashes)
	if hashes != 0 {
		t.Errorf("hashes after rollup = %d, want 0", hashes)
	}
	var oldSalts int
	pool.QueryRow(ctx, `SELECT count(*) FROM visitor_salts WHERE day < current_date`).Scan(&oldSalts)
	if oldSalts != 0 {
		t.Errorf("%d salts of counted days survived the rollup", oldSalts)
	}
	var metrics int
	pool.QueryRow(ctx, `SELECT count(*) FROM product_daily WHERE day = current_date`).Scan(&metrics)
	if metrics == 0 {
		t.Error("rollup wrote no product snapshot")
	}

	pool.Exec(ctx, `INSERT INTO usage_daily (day, feature, signed_in, app, device) VALUES (current_date - interval '26 months', 'old', false, false, 'other')`)
	if err := Prune(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var old int
	pool.QueryRow(ctx, `SELECT count(*) FROM usage_daily WHERE feature = 'old'`).Scan(&old)
	if old != 0 {
		t.Error("usage past the retention survived the prune")
	}
}

const (
	appUA     = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 GripelloApp"
	desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
)

func TestDeviceTypeIsACoarseClassOfTheUserAgent(t *testing.T) {
	for ua, want := range map[string]string{
		appUA:     "phone",
		desktopUA: "desktop",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148":       "phone",
		"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148":                "tablet",
		"Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130 Safari/537.36":            "tablet",
		"Mozilla/5.0 (Linux; Android 12; AFTMM) AppleWebKit/537.36 Chrome/130 Safari/537.36":              "tv",
		"Mozilla/5.0 (X11; CrOS armv7l 13597.84.0) AppleWebKit/537.36 Chrome/87 Safari/537.36 CrKey/1.54": "tv",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15":  "desktop",
		"Googlebot/2.1 (+http://www.google.com/bot.html)":                                                 "other",
		"": "other",
	} {
		if got := (Client{UserAgent: ua}).Device(); got != want {
			t.Errorf("Device(%q) = %s, want %s", ua, got, want)
		}
	}
}

func TestOSNameKeepsOnlyTheFamily(t *testing.T) {
	for ua, want := range map[string]string{
		appUA:     "android",
		desktopUA: "windows",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148":       "ios",
		"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148":                "ios",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15":  "macos",
		"Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0":                          "linux",
		"Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 Chrome/130 Safari/537.36":           "chromeos",
		"Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 SamsungBrowser/4.0 TV Safari/537.36": "linux",
		"Googlebot/2.1 (+http://www.google.com/bot.html)":                                                 "other",
	} {
		if got := (Client{UserAgent: ua}).OS(); got != want {
			t.Errorf("OS(%q) = %s, want %s", ua, got, want)
		}
	}
}

func TestAppIsTheNativeShellAndNamesItsPlatform(t *testing.T) {
	for ua, want := range map[string]bool{
		appUA: true,
		"Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36 GripelloApp/android":  true,
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 GripelloApp/ios": true,
		"Mozilla/5.0 Chrome/130 GripelloAppFake":                                               false,
		desktopUA:                                                                              false,
	} {
		if got := (Client{UserAgent: ua}).App(); got != want {
			t.Errorf("App(%q) = %t, want %t", ua, got, want)
		}
	}
	// The app's own token wins over a misleading user agent.
	if os := (Client{UserAgent: "Mozilla/5.0 (Macintosh) GripelloApp/ios"}).OS(); os != "ios" {
		t.Errorf("app token os = %s, want ios", os)
	}
}

func TestClientHintsDecideWhereBrowsersSendThem(t *testing.T) {
	reduced := "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"
	for _, c := range []struct {
		client     Client
		device, os string
	}{
		{Client{UserAgent: reduced, Mobile: "?0", Platform: "Android"}, "tablet", "android"},
		{Client{UserAgent: reduced, Mobile: "?1", Platform: "Android"}, "phone", "android"},
		{Client{UserAgent: desktopUA, Mobile: "?0", Platform: "Chrome OS"}, "desktop", "chromeos"},
		{Client{UserAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130", Mobile: "?0", Platform: "Linux"}, "desktop", "linux"},
		{Client{UserAgent: "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) Chrome/130", Mobile: "?0", Platform: "Android"}, "tv", "android"},
	} {
		if d, os := c.client.Device(), c.client.OS(); d != c.device || os != c.os {
			t.Errorf("%+v = %s/%s, want %s/%s", c.client, d, os, c.device, c.os)
		}
	}
}

func TestBotsAndLinkPreviewsAreNotUsage(t *testing.T) {
	for ua, bot := range map[string]bool{
		"Googlebot/2.1 (+http://www.google.com/bot.html)":                           true,
		"facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)": true,
		"WhatsApp/2.23.20.0 A":          true,
		"TelegramBot (like TwitterBot)": true,
		"Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)": true,
		"curl/8.5.0":      true,
		"kube-probe/1.31": true,
		"":                true,
		"Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36 Telegram-Android/11.2.3": false,
		desktopUA: false,
	} {
		if got := (Client{UserAgent: ua}).IsBot(); got != bot {
			t.Errorf("IsBot(%q) = %t, want %t", ua, got, bot)
		}
	}
	rec := New(nil)
	rec.Use("POST /api/me/ticks", http.StatusCreated, "", "203.0.113.9", Client{UserAgent: "WhatsApp/2.23.20.0 A"})
	if len(rec.usage) != 0 {
		t.Errorf("a link preview was counted as usage: %v", rec.usage)
	}
}
