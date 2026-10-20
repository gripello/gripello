package push

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"gripello/internal/platform/locales"
)

const ttlSeconds = 24 * 60 * 60

var serviceHosts = []string{
	"fcm.googleapis.com",
	".push.apple.com",
	".push.services.mozilla.com",
	".notify.windows.com",
}

type Subscription struct {
	Kind     string
	Endpoint string
	P256dh   string
	Auth     string
}

type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

type Sender struct {
	publicKey  string
	privateKey string
	subscriber atomic.Pointer[string]
	client     *http.Client
	fcm        *FCM
}

func New(publicKey, privateKey, senderAddress, appURL string) *Sender {
	s := &Sender{publicKey: publicKey, privateKey: privateKey, client: &http.Client{Timeout: 10 * time.Second}}
	s.UseSubject(senderAddress, appURL)
	return s
}

// UseSubject sets the VAPID sub claim: the mail sender address, else the app URL. Apple rejects an empty one with 403 BadJwtToken.
func (s *Sender) UseSubject(senderAddress, appURL string) {
	// webpush-go prefixes "mailto:" itself unless the subject is an https URL.
	subject := strings.TrimPrefix(strings.TrimSpace(senderAddress), "mailto:")
	if subject == "" && strings.HasPrefix(appURL, "https://") {
		subject = appURL
	}
	s.subscriber.Store(&subject)
}

func (s *Sender) subject() string { return *s.subscriber.Load() }

// UseFCM turns on delivery to the native apps.
func (s *Sender) UseFCM(credentials []byte) error {
	fcm, err := NewFCM(credentials, s.client)
	if err != nil {
		return err
	}
	s.fcm = fcm
	return nil
}

func (s *Sender) WebPushEnabled() bool { return s.publicKey != "" && s.privateKey != "" }

func (s *Sender) NativeEnabled() bool { return s.fcm != nil }

func (s *Sender) Enabled() bool { return s.WebPushEnabled() || s.NativeEnabled() }

// Delivers reports whether the channel of a subscription kind is configured.
func (s *Sender) Delivers(kind string) bool {
	if kind == KindFCM {
		return s.NativeEnabled()
	}
	return s.WebPushEnabled()
}

func (s *Sender) PublicKey() string { return s.publicKey }

// Send delivers one encrypted payload; gone means the subscription is dead (404/410) and should be deleted.
func (s *Sender) Send(ctx context.Context, sub Subscription, payload []byte) (gone bool, err error) {
	if sub.Kind == KindFCM {
		if s.fcm == nil {
			return false, errors.New("fcm is not configured")
		}
		return s.fcm.send(ctx, sub.Endpoint, payload)
	}
	if !s.WebPushEnabled() {
		return false, errors.New("web push is not configured")
	}
	response, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      s.subject(),
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             ttlSeconds,
		HTTPClient:      s.client,
	})
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone:
		return true, nil
	case response.StatusCode >= 300:
		// The services explain rejections in the body, e.g. Apple's {"reason":"BadJwtToken"}.
		reason, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return false, fmt.Errorf("push service answered %d: %s", response.StatusCode, strings.TrimSpace(string(reason)))
	}
	return false, nil
}

const MaxEndpointLength = 2048

func AllowedEndpoint(endpoint string) bool {
	if len(endpoint) > MaxEndpointLength {
		return false
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Port() != "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return slices.ContainsFunc(serviceHosts, func(allowed string) bool {
		if strings.HasPrefix(allowed, ".") {
			return strings.HasSuffix(host, allowed)
		}
		return host == allowed
	})
}

// Text is the bell's notifications.center.types.<type> label, so push and bell read the same.
func Text(messages locales.Messages, language, notificationType string, params map[string]any) string {
	return messages.Translate(language, "notifications.center.types."+notificationType, params)
}
