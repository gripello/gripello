package metrics

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UsageRetentionMonths keeps a year to compare with the year before; the privacy page states the same number.
const UsageRetentionMonths = 25

// Features maps the route patterns that show a climber or staff member using something to a feature key.
// Background reads every page makes (gym, settings, walls) are left out on purpose.
var Features = map[string]string{
	"GET /api/gyms/{gym}/routes":             "routes.browse",
	"GET /api/routes":                        "routes.browse",
	"GET /api/routes/{id}":                   "routes.detail",
	"GET /api/me/ticks":                      "logbook.view",
	"POST /api/me/ticks":                     "logbook.log",
	"GET /api/routes/{id}/ratings":           "reviews.read",
	"POST /api/routes/{id}/ratings":          "reviews.write",
	"GET /api/routes/{id}/betas":             "betas.watch",
	"POST /api/routes/{id}/betas":            "betas.upload",
	"GET /api/gyms/{gym}/leaderboard":        "leaderboard",
	"GET /api/me/feed":                       "friends.feed",
	"GET /api/climbers":                      "friends.search",
	"POST /api/follows":                      "friends.follow",
	"GET /api/climbers/{id}":                 "profiles",
	"GET /api/climbers/{id}/achievements":    "achievements",
	"GET /api/competitions/{id}/standings":   "competitions.view",
	"POST /api/competitions/{id}/entries":    "competitions.join",
	"PUT /api/competitions/{id}/scores":      "competitions.score",
	"POST /api/gyms/{gym}/competitions":      "competitions.create",
	"GET /api/gyms/{gym}/defects/open":       "defects.view",
	"GET /api/routes/{id}/defects":           "defects.view",
	"POST /api/gyms/{gym}/tasks":             "tasks.create",
	"GET /api/gyms/{gym}/tasks":              "tasks.manage",
	"POST /api/gyms/{gym}/routes":            "routes.set",
	"PATCH /api/routes/{id}":                 "routes.edit",
	"PUT /api/gyms/{gym}/routes/removal":     "routes.reset",
	"GET /api/gyms/{gym}/routes/reset-stats": "routes.reset",
	"PUT /api/locations/{id}/floor-plan":     "map.edit",
	"PUT /api/gyms/{gym}/map/placements":     "map.edit",
	"GET /api/gyms/{gym}/analytics":          "analytics",
	"POST /api/gyms/{gym}/ratings/import":    "import",
	"GET /api/moderation/cases":              "moderation",
	"POST /api/reports":                      "reports",
	"GET /api/gyms/{gym}/seasons":            "seasons",
	"GET /api/me/notifications":              "notifications",
	"POST /api/me/push-subscriptions":        "push.subscribe",
	"POST /api/me/export":                    "account.export",
	"POST /api/auth/register":                "auth.register",
	"POST /api/auth/login":                   "auth.login",
	"POST /api/auth/passkey":                 "auth.passkey",
	"POST /api/auth/oauth2/finish":           "auth.oauth2",
	"POST /api/me/totp":                      "account.2fa",
	"POST /api/me/passkeys":                  "account.2fa",
	"POST /api/gyms/{gym}/members":           "members.invite",
	"POST /api/me/followed-walls/{wall}":     "walls.follow",
}

type usageKey struct {
	day, feature, device, os string
	signedIn, app            bool
}

type usagePerson struct {
	usageKey
	who string
}

// Client is what a request says about its device without being asked: the user agent and the two client hints
// Chromium browsers send by default. High-entropy hints are never requested (Accept-CH would be device access).
type Client struct{ UserAgent, Mobile, Platform string }

func ClientOf(r *http.Request) Client {
	return Client{
		UserAgent: r.UserAgent(),
		Mobile:    r.Header.Get("Sec-CH-UA-Mobile"),
		Platform:  strings.Trim(r.Header.Get("Sec-CH-UA-Platform"), `"`),
	}
}

func containsAny(s string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

// botWords catches crawlers, link previews (shared route links), monitors and scripts; they are not counted as usage.
var botWords = []string{"bot", "crawl", "spider", "slurp", "preview", "facebookexternalhit", "whatsapp",
	"embedly", "vkshare", "skypeuripreview", "headless", "lighthouse", "pingdom", "uptime", "monitor",
	"kube-probe", "curl", "wget", "python", "go-http", "okhttp", "java/", "axios", "node-fetch", "undici", "httpclient",
	"postman", "insomnia", "scrapy", "feedfetcher", "bingpreview", "gptbot", "claudebot", "perplexity", "bytespider"}

func (c Client) IsBot() bool {
	ua := strings.ToLower(c.UserAgent)
	return ua == "" || containsAny(ua, botWords...)
}

const appToken = "GripelloApp"

// appPlatform is the platform the native shell names after its token ("GripelloApp/android"), or "" for older builds.
func (c Client) appPlatform() (platform string, ok bool) {
	i := strings.LastIndex(c.UserAgent, appToken)
	if i < 0 {
		return "", false
	}
	rest := strings.TrimSpace(c.UserAgent[i+len(appToken):])
	if rest == "" {
		return "", true
	}
	if after, found := strings.CutPrefix(rest, "/"); found {
		return strings.ToLower(strings.Fields(after + " ")[0]), true
	}
	return "", false
}

func (c Client) App() bool {
	_, ok := c.appPlatform()
	return ok
}

var hintPlatforms = map[string]string{"Android": "android", "iOS": "ios", "macOS": "macos", "Windows": "windows",
	"Linux": "linux", "Chrome OS": "chromeos", "Chromium OS": "chromeos"}

var osFamilies = map[string]bool{"android": true, "ios": true, "macos": true, "windows": true, "linux": true, "chromeos": true}

// OS keeps only the operating system family, never its version: the app's own token first, then the platform hint,
// then the user agent.
func (c Client) OS() string {
	if platform, _ := c.appPlatform(); osFamilies[platform] {
		return platform
	}
	if os := hintPlatforms[c.Platform]; os != "" {
		return os
	}
	ua := strings.ToLower(c.UserAgent)
	switch {
	case containsAny(ua, "iphone", "ipad", "ipod"):
		return "ios"
	case strings.Contains(ua, "android"):
		return "android"
	case strings.Contains(ua, "cros"):
		return "chromeos"
	case strings.Contains(ua, "windows"):
		return "windows"
	case containsAny(ua, "macintosh", "mac os x"):
		return "macos"
	case containsAny(ua, "linux", "x11"):
		return "linux"
	}
	return "other"
}

// Device sorts the client into a coarse class; the mobile hint, where sent, decides phone versus tablet or desktop.
// ponytail: iPads in desktop mode send a Mac user agent and no hints, so they count as desktop; only device-side
// JavaScript could tell, which would need consent.
func (c Client) Device() string {
	ua := strings.ToLower(c.UserAgent)
	switch {
	case containsAny(ua, "smart-tv", "smarttv", "googletv", "android tv", "crkey", "aftb", "aftm", "aftt", "web0s", "tizen", "bravia"):
		return "tv"
	case c.Mobile == "?1":
		return "phone"
	case c.Mobile == "?0" && c.OS() == "android":
		return "tablet"
	case c.Mobile == "?0" && c.Platform != "":
		return "desktop"
	case containsAny(ua, "ipad", "tablet") || (strings.Contains(ua, "android") && !strings.Contains(ua, "mobile")):
		return "tablet"
	case containsAny(ua, "mobi", "iphone", "ipod", "android"):
		return "phone"
	case c.OS() == "other":
		return "other"
	}
	return "desktop"
}

// RollupUsage counts the people of finished days and deletes their hashes, then snapshots the account-level numbers
// that can't be rebuilt later. People are added, so hashes a late flush wrote after an earlier rollup still count.
func RollupUsage(ctx context.Context, pool *pgxpool.Pool) error {
	today := time.Now().UTC().Format(time.DateOnly)
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE usage_daily d SET people = d.people + p.n
			FROM (SELECT day, feature, signed_in, app, device, os, count(*) AS n FROM usage_people WHERE day < $1
				GROUP BY day, feature, signed_in, app, device, os) p
			WHERE d.day = p.day AND d.feature = p.feature AND d.signed_in = p.signed_in AND d.app = p.app
				AND d.device = p.device AND d.os = p.os`, today); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM usage_people WHERE day < $1`, today); err != nil {
			return err
		}
		// The privacy text promises the key goes with the codes; older visitor hashes can't be linked to IPs any more.
		if _, err := tx.Exec(ctx, `DELETE FROM visitor_salts WHERE day < $1`, today); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO product_daily (day, metric, value)
			SELECT $1::date, metric, value FROM (VALUES
				('accounts', (SELECT count(*) FROM users)),
				('accounts_verified', (SELECT count(*) FROM users WHERE verified)),
				('active_7d', (SELECT count(*) FROM user_last_seen WHERE last_seen >= now() - interval '7 days')),
				('active_30d', (SELECT count(*) FROM user_last_seen WHERE last_seen >= now() - interval '30 days')),
				('push_enabled', (SELECT count(DISTINCT "user") FROM push_subscriptions)),
				('two_factor', (SELECT count(DISTINCT "user") FROM mfa_factors)),
				('ticks_private', (SELECT count(*) FROM users WHERE ticks_private)),
				('leaderboard_hidden', (SELECT count(*) FROM users WHERE leaderboard_hidden)),
				('reviews_anonymous', (SELECT count(*) FROM users WHERE reviews_anonymous))
			) AS m(metric, value)
			ON CONFLICT (day, metric) DO UPDATE SET value = excluded.value`, today)
		return err
	})
}

func pruneUsage(ctx context.Context, pool *pgxpool.Pool) error {
	cutoff := time.Now().UTC().AddDate(0, -UsageRetentionMonths, 0).Format(time.DateOnly)
	if _, err := pool.Exec(ctx, `DELETE FROM usage_daily WHERE day < $1`, cutoff); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `DELETE FROM product_daily WHERE day < $1`, cutoff)
	return err
}
