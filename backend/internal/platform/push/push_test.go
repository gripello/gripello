package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"

	"gripello/internal/platform/locales"
)

func TestTextReadsTheAppLocales(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "en.json"), []byte(`{"notifications":{"center":{"types":{"task_assigned":"Assigned: {title}","report_filed":"Report"}}}}`), 0o644)
	os.WriteFile(filepath.Join(dir, "de.json"), []byte(`{"notifications":{"center":{"types":{"task_assigned":"Zugewiesen: {title}"}}}}`), 0o644)
	messages := locales.Load(dir)

	if got := Text(messages, "de", "task_assigned", map[string]any{"title": "Griff"}); got != "Zugewiesen: Griff" {
		t.Errorf("de = %q", got)
	}
	if got := Text(messages, "de", "report_filed", nil); got != "Report" {
		t.Errorf("missing key falls back to en, got %q", got)
	}
	if got := Text(messages, "", "task_assigned", map[string]any{"title": 3}); got != "Assigned: 3" {
		t.Errorf("no language = %q", got)
	}
}

func TestTextCoversEveryNotificationTypeInTheRealLocales(t *testing.T) {
	messages := locales.Load("../../../../i18n/locales")
	if len(messages) == 0 {
		t.Fatal("no locales found")
	}
	for _, notificationType := range []string{"task_defect_filed", "task_defect_fixed", "task_assigned", "report_filed", "report_decided_kept", "report_decided_removed", "wall_new_routes", "competition_published"} {
		for language := range messages {
			if messages.Lookup(language, "notifications.center.types."+notificationType) == "" {
				t.Errorf("%s has no %s", language, notificationType)
			}
		}
	}
}

func TestOnlyPushServiceEndpointsAreAllowed(t *testing.T) {
	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/abc",
		"https://web.push.apple.com/QGx",
		"https://updates.push.services.mozilla.com/wpush/v2/x",
		"https://wns2-db5p.notify.windows.com/w/?token=x",
	} {
		if !AllowedEndpoint(endpoint) {
			t.Errorf("rejected %s", endpoint)
		}
	}
	for _, endpoint := range []string{
		"http://fcm.googleapis.com/fcm/send/abc",
		"https://127.0.0.1/api/collections",
		"https://localhost:8080/",
		"https://fcm.googleapis.com.evil.example/x",
		"https://evilpush.apple.com/x",
		"https://fcm.googleapis.com:8443/x",
		"not a url",
		"https://fcm.googleapis.com/fcm/send/" + strings.Repeat("a", MaxEndpointLength),
	} {
		if AllowedEndpoint(endpoint) {
			t.Errorf("accepted %s", endpoint)
		}
	}
}

func TestSubjectFallsBackToTheAppURLAndFollowsTheMailSettings(t *testing.T) {
	sender := New("", "", "mailto:env@gripello.app", "https://gripello.app")
	if got := sender.subject(); got != "env@gripello.app" {
		t.Errorf("got %q, webpush-go adds the prefix itself", got)
	}
	sender.UseSubject("", "https://gripello.app")
	if got := sender.subject(); got != "https://gripello.app" {
		t.Errorf("without a sender address the subject must be the app URL, got %q", got)
	}
	sender.UseSubject(" no-reply@example.com ", "https://gripello.app")
	if got := sender.subject(); got != "no-reply@example.com" {
		t.Errorf("platform sender address not applied, got %q", got)
	}
	sender.UseSubject("", "http://localhost:3000")
	if got := sender.subject(); got != "" {
		t.Errorf("an http URL is no valid subject, got %q", got)
	}
	if New("pub", "", "x", "").Enabled() || !New("pub", "priv", "x", "").Enabled() {
		t.Error("Enabled needs both keys")
	}
}

func TestSendReportsGoneSubscriptions(t *testing.T) {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	status, body := http.StatusGone, ""
	var subjects []string
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subjects = append(subjects, vapidSubject(t, r.Header.Get("Authorization")))
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	defer service.Close()

	key, _ := ecdh.P256().GenerateKey(rand.Reader)
	secret := make([]byte, 16)
	rand.Read(secret)
	sub := Subscription{
		Endpoint: service.URL,
		P256dh:   base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(secret),
	}
	sender := New(publicKey, privateKey, "push@gripello.app", "")
	payload, _ := json.Marshal(Payload{Title: "Gripello", Body: "hi", URL: "/", Tag: "test"})

	if gone, err := sender.Send(context.Background(), sub, payload); err != nil || !gone {
		t.Errorf("410: gone=%v err=%v", gone, err)
	}
	if subjects[0] != "mailto:push@gripello.app" {
		t.Errorf("signed sub = %q", subjects[0])
	}
	status = http.StatusCreated
	if gone, err := sender.Send(context.Background(), sub, payload); err != nil || gone {
		t.Errorf("201: gone=%v err=%v", gone, err)
	}
	status, body = http.StatusForbidden, `{"reason":"BadJwtToken"}`
	gone, err := sender.Send(context.Background(), sub, payload)
	if gone || err == nil || !strings.Contains(err.Error(), "403") || !strings.Contains(err.Error(), "BadJwtToken") {
		t.Errorf("a rejected push must surface status and reason: gone=%v err=%v", gone, err)
	}
}

// vapidSubject reads the sub claim of the "vapid t=<jwt>, k=<key>" header the push service receives.
func vapidSubject(t *testing.T, header string) string {
	t.Helper()
	token := strings.TrimPrefix(strings.SplitN(header, ",", 2)[0], "vapid t=")
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("authorization header %q", header)
	}
	claims, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Sub string `json:"sub"`
	}
	json.Unmarshal(claims, &decoded)
	return decoded.Sub
}
