package achievements

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/ratelimit"
)

const (
	jobKind          = "achievements"
	coalesceDelay    = 2 * time.Second
	lookupsPerMinute = 60
	publicCacheTTL   = time.Minute
)

type cachedViews struct {
	at    time.Time
	views []achievementView
}

type module struct {
	app     *platform.App
	lookups *ratelimit.Limiter
	mu      sync.Mutex
	cache   map[string]cachedViews
}

func Register(app *platform.App) { newModule(app) }

func newModule(app *platform.App) *module {
	m := &module{app: app, lookups: ratelimit.New(lookupsPerMinute, time.Minute), cache: map[string]cachedViews{}}
	app.Handle("GET /climbers/{id}/achievements", httpx.Handler(m.getAchievements))
	app.Worker(jobKind, m.evaluate)
	for _, topic := range []string{"tick.changed", "rating.created", "beta.created", "entry.created"} {
		app.Bus.Subscribe(topic, m.queueField("user"))
	}
	app.Bus.Subscribe("follow.changed", m.onFollow)
	app.Bus.Subscribe("notify", m.onNotify)
	app.Cron.Add("achievementsSeasons", "30 3 * * *", func(ctx context.Context) error { return m.queueSeasonPlacements(ctx, time.Now()) })
	return m
}

// Every replica sees each event; the queue coalesces the duplicate enqueues per climber.
func (m *module) queue(userID string) {
	if userID == "" {
		return
	}
	if err := jobs.Enqueue(context.Background(), m.app.DB, jobKind, userID, nil, coalesceDelay); err != nil {
		slog.Error("achievements: enqueue failed", "user", userID, "error", err)
	}
}

func (m *module) queueField(field string) events.Handler {
	return func(e events.Event) {
		var payload map[string]any
		if json.Unmarshal(e.Payload, &payload) == nil {
			userID, _ := payload[field].(string)
			m.queue(userID)
		}
	}
}

func (m *module) onFollow(e events.Event) {
	var change struct {
		Follower string `json:"follower"`
		Followee string `json:"followee"`
		Status   string `json:"status"`
	}
	if json.Unmarshal(e.Payload, &change) == nil && change.Status == "accepted" {
		m.queue(change.Follower)
		m.queue(change.Followee)
	}
}

func (m *module) onNotify(e events.Event) {
	var n Notify
	if e.Kind == "notify" && json.Unmarshal(e.Payload, &n) == nil && n.Type == "task_defect_fixed" {
		for _, userID := range n.Users {
			m.queue(userID)
		}
	}
}

func (m *module) evaluate(ctx context.Context, job jobs.Job) error {
	_, err := award(ctx, m.app.DB, job.Key, time.Now())
	return err
}

func (m *module) queueSeasonPlacements(ctx context.Context, now time.Time) error {
	users, err := finishedSeasonTopTens(ctx, m.app.DB, now)
	if err != nil {
		return err
	}
	for _, userID := range users {
		m.queue(userID)
	}
	return nil
}

type achievementView struct {
	achievement
	Value   int      `json:"value"`
	Current int      `json:"current"`
	Tier    int      `json:"tier"`
	Earned  []string `json:"earned"`
}

func (m *module) getAchievements(w http.ResponseWriter, r *http.Request) error {
	principal, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	if err := m.lookups.Check(w, principal.UserID); err != nil {
		return err
	}
	userID := r.PathValue("id")
	self := userID == principal.UserID
	exists, visible, err := profileVisible(r.Context(), m.app.DB, principal.UserID, userID)
	if err != nil {
		return err
	}
	if !exists || !self && !visible {
		return httpx.ErrNotFound
	}
	var views []achievementView
	if self {
		views, err = m.views(r.Context(), userID, true)
	} else {
		views, err = m.publicViews(r.Context(), userID, time.Now())
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, views)
	return nil
}

// publicViews leaves out the running streak and earned dates; computing is costly, so other viewers share a short per-climber cache.
func (m *module) publicViews(ctx context.Context, userID string, now time.Time) ([]achievementView, error) {
	m.mu.Lock()
	cached, ok := m.cache[userID]
	m.mu.Unlock()
	if ok && now.Sub(cached.at) < publicCacheTTL {
		return cached.views, nil
	}
	views, err := m.views(ctx, userID, false)
	if err != nil {
		return nil, err
	}
	for i := range views {
		views[i].Current = 0
		views[i].Earned = make([]string, len(views[i].Earned))
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, entry := range m.cache {
		if now.Sub(entry.at) >= publicCacheTTL {
			delete(m.cache, id)
		}
	}
	m.cache[userID] = cachedViews{at: now, views: views}
	return views, nil
}

func (m *module) views(ctx context.Context, userID string, includePrivate bool) ([]achievementView, error) {
	metrics, err := computeAchievements(ctx, m.app.DB, userID, time.Now())
	if err != nil {
		return nil, err
	}
	stored, err := storedBadges(ctx, m.app.DB, userID)
	if err != nil {
		return nil, err
	}
	earnedDays := map[string]map[int]string{}
	for _, b := range stored {
		if earnedDays[b.Key] == nil {
			earnedDays[b.Key] = map[int]string{}
		}
		earnedDays[b.Key][b.Tier] = b.Earned
	}
	views := []achievementView{}
	for _, definition := range achievements {
		if definition.Private && !includePrivate {
			continue
		}
		current := metrics[definition.Key]
		tier := tierFor(definition, current.Value)
		earned := make([]string, tier)
		for index := range earned {
			earned[index] = earnedDays[definition.Key][index+1]
		}
		views = append(views, achievementView{achievement: definition, Value: current.Value, Current: current.Current, Tier: tier, Earned: earned})
	}
	return views, nil
}
