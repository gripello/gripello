package push

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fcmSender(t *testing.T, answer func(w http.ResponseWriter, message map[string]any)) *Sender {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"access_token":"access","token_type":"Bearer","expires_in":3600}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer access" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		answer(w, body["message"].(map[string]any))
	}))
	t.Cleanup(server.Close)
	credentials, _ := json.Marshal(map[string]string{
		"project_id":   "gripello",
		"client_email": "push@gripello.iam.gserviceaccount.com",
		"private_key":  string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})),
		"token_uri":    server.URL + "/token",
	})
	sender := New("", "", "", "")
	if err := sender.UseFCM(credentials); err != nil {
		t.Fatal(err)
	}
	sender.fcm.sendURL = server.URL + "/send"
	return sender
}

func TestFCMSendsTheNotificationWithItsLink(t *testing.T) {
	var got map[string]any
	sender := fcmSender(t, func(w http.ResponseWriter, message map[string]any) { got = message })
	if !sender.Enabled() || sender.WebPushEnabled() || !sender.NativeEnabled() || sender.Delivers(KindWebPush) || !sender.Delivers(KindFCM) {
		t.Fatal("fcm alone should enable native push only")
	}
	payload, _ := json.Marshal(Payload{Title: "Alpha", Body: "Fixed", URL: "/route?id=x", Tag: "task_defect_fixed"})
	gone, err := sender.Send(context.Background(), Subscription{Kind: KindFCM, Endpoint: "device-token"}, payload)
	if gone || err != nil {
		t.Fatalf("gone=%v err=%v", gone, err)
	}
	notification := got["notification"].(map[string]any)
	data := got["data"].(map[string]any)
	if got["token"] != "device-token" || notification["title"] != "Alpha" || notification["body"] != "Fixed" || data["url"] != "/route?id=x" {
		t.Errorf("message = %v", got)
	}
	android := got["android"].(map[string]any)["notification"].(map[string]any)
	apns := got["apns"].(map[string]any)["headers"].(map[string]any)
	if android["tag"] != "task_defect_fixed" || apns["apns-collapse-id"] != "task_defect_fixed" || apns["apns-expiration"] == "" {
		t.Errorf("replacing by tag: android=%v apns=%v", android, apns)
	}
}

func TestFCMLeavesUntaggedNotificationsUncollapsedOnIOS(t *testing.T) {
	var got map[string]any
	sender := fcmSender(t, func(w http.ResponseWriter, message map[string]any) { got = message })
	if _, err := sender.Send(context.Background(), Subscription{Kind: KindFCM, Endpoint: "device-token"}, []byte(`{"title":"Alpha"}`)); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["apns"].(map[string]any)["headers"].(map[string]any)["apns-collapse-id"]; ok {
		t.Errorf("an empty apns-collapse-id makes APNs reject the message: %v", got["apns"])
	}
}

func TestFCMReportsUnregisteredTokensAsGone(t *testing.T) {
	for name, answer := range map[string]func(http.ResponseWriter){
		"not found": func(w http.ResponseWriter) { w.WriteHeader(http.StatusNotFound) },
		"unregistered": func(w http.ResponseWriter) {
			w.WriteHeader(http.StatusBadRequest)
			io.WriteString(w, `{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}`)
		},
	} {
		sender := fcmSender(t, func(w http.ResponseWriter, _ map[string]any) { answer(w) })
		gone, err := sender.Send(context.Background(), Subscription{Kind: KindFCM, Endpoint: "device-token"}, []byte(`{}`))
		if !gone || err != nil {
			t.Errorf("%s: gone=%v err=%v", name, gone, err)
		}
	}
	sender := fcmSender(t, func(w http.ResponseWriter, _ map[string]any) { w.WriteHeader(http.StatusInternalServerError) })
	if gone, err := sender.Send(context.Background(), Subscription{Kind: KindFCM, Endpoint: "device-token"}, []byte(`{}`)); gone || err == nil {
		t.Errorf("server error: gone=%v err=%v", gone, err)
	}
}

func TestUnconfiguredChannelsRefuseToSend(t *testing.T) {
	sender := New("", "", "", "")
	if _, err := sender.Send(context.Background(), Subscription{Kind: KindFCM, Endpoint: "x"}, []byte(`{}`)); err == nil || !strings.Contains(err.Error(), "fcm") {
		t.Errorf("fcm err = %v", err)
	}
	if _, err := sender.Send(context.Background(), Subscription{Kind: KindWebPush, Endpoint: "https://fcm.googleapis.com/x"}, []byte(`{}`)); err == nil {
		t.Error("web push sent without VAPID keys")
	}
	if err := sender.UseFCM([]byte(`{"project_id":"x"}`)); err == nil {
		t.Error("incomplete credentials accepted")
	}
}

func TestFCMTokensAreValidated(t *testing.T) {
	if !ValidFCMToken("dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH-1RYqx") {
		t.Error("real-looking token rejected")
	}
	for _, token := range []string{"", "short", "https://evil.example/x", strings.Repeat("a", MaxEndpointLength+1)} {
		if ValidFCMToken(token) {
			t.Errorf("accepted %q", token)
		}
	}
}
