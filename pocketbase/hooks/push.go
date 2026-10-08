package hooks

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/routine"
)

const (
	pushTTLSeconds      = 24 * 60 * 60
	pushTimeout         = 10 * time.Second
	testPushesPerMinute = 3
)

var pushServiceHosts = []string{
	"fcm.googleapis.com",
	".push.apple.com",
	".push.services.mozilla.com",
	".notify.windows.com",
}

var (
	// hooks hand us transaction apps that are dead once the push goes out
	pushApp core.App
)

type pushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

type pushDelivery struct {
	id           string
	subscription webpush.Subscription
	payload      []byte
}

func isPushServiceEndpoint(endpoint string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Port() != "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return slices.ContainsFunc(pushServiceHosts, func(allowed string) bool {
		if strings.HasPrefix(allowed, ".") {
			return strings.HasSuffix(host, allowed)
		}
		return host == allowed
	})
}

func pushText(messages localeMessages, language, notificationType string, params map[string]any) string {
	return messages.translate(language, "notifications.center.types."+notificationType, params)
}

func vapidKeys() (string, string) {
	return os.Getenv("PB_VAPID_PUBLIC_KEY"), os.Getenv("PB_VAPID_PRIVATE_KEY")
}

var testPushes = newUserRateLimiter(testPushesPerMinute)

func registerPush(app core.App) {
	pushApp = app
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/notifications/test", serveTestPush).Bind(apis.RequireAuth("users"), testPushes.middleware())
		return se.Next()
	})
	app.OnRecordCreateRequest("push_subscriptions").BindFunc(func(e *core.RecordRequestEvent) error {
		if !isPushServiceEndpoint(e.Record.GetString("endpoint")) {
			return apis.NewBadRequestError("Unknown push service.", nil)
		}
		return e.Next()
	})
	app.OnRecordCreate("push_subscriptions").BindFunc(func(e *core.RecordEvent) error {
		_, err := e.App.DB().NewQuery("DELETE FROM push_subscriptions WHERE endpoint = {:endpoint}").
			Bind(dbx.Params{"endpoint": e.Record.GetString("endpoint")}).Execute()
		if err != nil {
			return err
		}
		return e.Next()
	})
}

func serveTestPush(e *core.RequestEvent) error {
	body := struct {
		Endpoint string `json:"endpoint"`
	}{}
	if err := e.BindBody(&body); err != nil || body.Endpoint == "" {
		return e.BadRequestError("", err)
	}
	publicKey, privateKey := vapidKeys()
	if publicKey == "" || privateKey == "" {
		return e.Error(http.StatusServiceUnavailable, "Push is not configured.", nil)
	}
	subscription, err := e.App.FindFirstRecordByFilter("push_subscriptions", "user = {:user} && endpoint = {:endpoint}",
		dbx.Params{"user": e.Auth.Id, "endpoint": body.Endpoint})
	if err != nil {
		return e.NotFoundError("", err)
	}
	payload, _ := json.Marshal(pushPayload{
		Title: e.App.Settings().Meta.AppName,
		Body:  loadedLocales(e.App).translate(e.Auth.GetString("language"), "accountSettings.push.testMessage", nil),
		URL:   "/account/settings",
		Tag:   "test",
	})
	deliverPush(e.App, []pushDelivery{{
		id: subscription.Id,
		subscription: webpush.Subscription{
			Endpoint: subscription.GetString("endpoint"),
			Keys:     webpush.Keys{P256dh: subscription.GetString("p256dh"), Auth: subscription.GetString("auth")},
		},
		payload: payload,
	}}, &webpush.Options{
		Subscriber:      vapidSubscriber(e.App),
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             pushTTLSeconds,
		HTTPClient:      &http.Client{Timeout: pushTimeout},
	})
	return e.NoContent(http.StatusNoContent)
}

func sendPush(app core.App, users []*core.Record, message notification) {
	publicKey, privateKey := vapidKeys()
	if publicKey == "" || privateKey == "" {
		return
	}
	deliveries := pushDeliveries(app, loadedLocales(app), users, message)
	if len(deliveries) == 0 {
		return
	}
	options := &webpush.Options{
		Subscriber:      vapidSubscriber(app),
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		TTL:             pushTTLSeconds,
		HTTPClient:      &http.Client{Timeout: pushTimeout},
	}
	deliver := func() { deliverPush(pushApp, deliveries, options) }

	if txInfo := app.TxInfo(); txInfo != nil {
		txInfo.OnComplete(func(txErr error) error {
			if txErr == nil {
				routine.FireAndForget(deliver)
			}
			return nil
		})
		return
	}
	routine.FireAndForget(deliver)
}

// webpush-go prefixes "mailto:" itself and signs an empty subject, which push services reject.
func vapidSubscriber(app core.App) string {
	return strings.TrimPrefix(firstNonEmpty(os.Getenv("PB_SENDER_ADDRESS"), app.Settings().Meta.SenderAddress), "mailto:")
}

func pushDeliveries(app core.App, messages localeMessages, users []*core.Record, message notification) []pushDelivery {
	title := firstNonEmpty(gymName(app, message.Gym), app.Settings().Meta.AppName)

	var deliveries []pushDelivery
	for _, user := range users {
		if !wantsNotification(user, pushChannel, message.Type) {
			continue
		}
		subscriptions, err := app.FindAllRecords("push_subscriptions", dbx.HashExp{"user": user.Id})
		if err != nil || len(subscriptions) == 0 {
			continue
		}
		payload, _ := json.Marshal(pushPayload{
			Title: title,
			Body:  pushText(messages, user.GetString("language"), message.Type, message.Params),
			URL:   message.URL,
			Tag:   message.Type,
		})
		for _, subscription := range subscriptions {
			deliveries = append(deliveries, pushDelivery{
				id: subscription.Id,
				subscription: webpush.Subscription{
					Endpoint: subscription.GetString("endpoint"),
					Keys: webpush.Keys{
						P256dh: subscription.GetString("p256dh"),
						Auth:   subscription.GetString("auth"),
					},
				},
				payload: payload,
			})
		}
	}
	return deliveries
}

func deliverPush(app core.App, deliveries []pushDelivery, options *webpush.Options) {
	for _, delivery := range deliveries {
		response, err := webpush.SendNotification(delivery.payload, &delivery.subscription, options)
		if err != nil {
			app.Logger().Warn("push: send failed", "subscription", delivery.id, "error", err)
			continue
		}
		response.Body.Close()
		if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone {
			if _, err := app.DB().NewQuery("DELETE FROM push_subscriptions WHERE id = {:id}").
				Bind(dbx.Params{"id": delivery.id}).Execute(); err != nil {
				app.Logger().Error("push: failed to drop expired subscription", "subscription", delivery.id, "error", err)
			}
		}
	}
}
