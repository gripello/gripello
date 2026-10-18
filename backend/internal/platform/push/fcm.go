package push

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/jwt"
)

const (
	KindWebPush = "webpush"
	KindFCM     = "fcm"
)

var fcmToken = regexp.MustCompile(`^[A-Za-z0-9_:\-]+$`)

func ValidFCMToken(token string) bool {
	return len(token) >= 20 && len(token) <= 4096 && fcmToken.MatchString(token)
}

// FCM sends to the native apps through the Firebase Cloud Messaging HTTP v1 API.
type FCM struct {
	sendURL string
	tokens  oauth2.TokenSource
	client  *http.Client
}

type serviceAccount struct {
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

// NewFCM reads a Firebase service account key (the JSON downloaded from the Firebase console).
func NewFCM(credentials []byte, client *http.Client) (*FCM, error) {
	var account serviceAccount
	if err := json.Unmarshal(credentials, &account); err != nil {
		return nil, fmt.Errorf("fcm credentials: %w", err)
	}
	if account.ProjectID == "" || account.ClientEmail == "" || account.PrivateKey == "" || account.TokenURI == "" {
		return nil, errors.New("fcm credentials: project_id, client_email, private_key and token_uri are required")
	}
	config := &jwt.Config{
		Email:      account.ClientEmail,
		PrivateKey: []byte(account.PrivateKey),
		TokenURL:   account.TokenURI,
		Scopes:     []string{"https://www.googleapis.com/auth/firebase.messaging"},
	}
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, client)
	return &FCM{
		sendURL: "https://fcm.googleapis.com/v1/projects/" + account.ProjectID + "/messages:send",
		tokens:  oauth2.ReuseTokenSource(nil, config.TokenSource(ctx)),
		client:  client,
	}, nil
}

func (f *FCM) send(ctx context.Context, token string, payload []byte) (gone bool, err error) {
	var p Payload
	if err := json.Unmarshal(payload, &p); err != nil {
		return false, err
	}
	// iOS: the same lifetime as the Android ttl, and a newer notification with the tag replaces the older one.
	apnsHeaders := map[string]string{"apns-expiration": strconv.FormatInt(time.Now().Unix()+ttlSeconds, 10)}
	if p.Tag != "" {
		apnsHeaders["apns-collapse-id"] = p.Tag
	}
	message, _ := json.Marshal(map[string]any{"message": map[string]any{
		"token":        token,
		"notification": map[string]string{"title": p.Title, "body": p.Body},
		"data":         map[string]string{"url": p.URL, "tag": p.Tag},
		"android": map[string]any{
			"ttl":          fmt.Sprintf("%ds", ttlSeconds),
			"notification": map[string]string{"tag": p.Tag},
		},
		"apns": map[string]any{"headers": apnsHeaders},
	}})
	bearer, err := f.tokens.Token()
	if err != nil {
		return false, fmt.Errorf("fcm token: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, f.sendURL, bytes.NewReader(message))
	if err != nil {
		return false, err
	}
	request.Header.Set("Content-Type", "application/json")
	bearer.SetAuthHeader(request)
	response, err := f.client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode < 300 {
		return false, nil
	}
	reason, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
	// An uninstalled app or a rotated token answers 404 NOT_FOUND with errorCode UNREGISTERED.
	if response.StatusCode == http.StatusNotFound || strings.Contains(string(reason), "UNREGISTERED") {
		return true, nil
	}
	return false, fmt.Errorf("fcm answered %d: %s", response.StatusCode, strings.TrimSpace(string(reason)))
}
