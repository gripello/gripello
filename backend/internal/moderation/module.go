package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"time"

	"gripello/internal/platform"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

type module struct {
	app      *platform.App
	perms    *tenancy.Permissions
	climbers *climbers.Lookup
}

func Register(app *platform.App) {
	m := &module{app: app, perms: tenancy.New(app.DB), climbers: climbers.New(app.DB)}
	for pattern, handler := range map[string]httpx.Handler{
		"POST /reports":                      m.createReport,
		"GET /gyms/{gym}/reports":            m.listGymReports,
		"GET /platform/reports":              m.listPlatformReports,
		"GET /moderation/summary":            m.summary,
		"GET /moderation/cases":              m.listCases,
		"POST /moderation/cases":             m.openCase,
		"GET /moderation/{id}":               m.getCase,
		"POST /moderation/{id}":              m.decide,
		"POST /moderation/authors/{id}/hide": m.hideAuthor,
	} {
		app.Handle(pattern, handler)
	}
	if app.Bus != nil {
		app.Bus.SubscribeOnce("rating.created", "moderation.rating", m.onCreated("rating", hasComment))
		app.Bus.SubscribeOnce("beta.created", "moderation.beta", m.onCreated("beta_video", nil))
		app.Bus.SubscribeOnce("entry.created", "moderation.entry", m.onCreated("competition_entry", nil))
		app.Bus.SubscribeOnce("beta.pending", "moderation.pending", m.onBetaPending)
		app.Bus.SubscribeOnce("user:", "moderation.user", m.onUser)
		app.Bus.SubscribeOnce("gym_changes:", "moderation.gym_changes", m.onGymChange)
		app.Bus.SubscribeOnce("tasks:", "moderation.tasks", m.onTaskChange)
		app.Bus.SubscribeOnce("competition_changes:", "moderation.competition_changes", m.onCompetitionChange)
		app.Bus.SubscribeOnce("entry.deleted", "moderation.entry_deleted", m.onEntryDeleted)
	}
	if app.Cron != nil {
		app.Cron.Add("moderationRetention", "29 3 * * *", m.pruneQuarantine)
	}
}

func handlerContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func hasComment(c content) bool {
	comment, _ := c.Snapshot["comment"].(string)
	return comment != ""
}

func logFailure(what, id string, err error) {
	if err != nil && !errors.Is(err, httpx.ErrNotFound) {
		slog.Error("moderation: "+what+" failed", "content", id, "error", err)
	}
}

// onCreated opens a case for new content; a case that exists already (approve, restore, a replayed event) stays as it is.
func (m *module) onCreated(kindName string, when func(content) bool) events.Handler {
	return func(e events.Event) {
		var payload struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(e.Payload, &payload) != nil || payload.ID == "" {
			return
		}
		ctx, cancel := handlerContext()
		defer cancel()
		logFailure("queueing", payload.ID, m.inTx(ctx, func(w *work) error {
			if when != nil {
				c, err := loadContent(ctx, w.tx, kindName, payload.ID)
				if err != nil || !when(c) {
					return err
				}
			}
			_, err := m.queue(ctx, w, kindName, payload.ID, true)
			return err
		}))
	}
}

func (m *module) onBetaPending(e events.Event) {
	var p struct {
		ID, Gym, Route, User, URL, File string
		FileKey                         string `json:"file_key"`
	}
	if json.Unmarshal(e.Payload, &p) != nil || p.ID == "" {
		return
	}
	ctx, cancel := handlerContext()
	defer cancel()
	logFailure("holding upload", p.ID, m.inTx(ctx, func(w *work) error {
		names := []string{}
		if p.File != "" {
			names = append(names, p.File)
		}
		it, inserted, err := insertItem(ctx, w.tx, Item{
			ID: ids.New(), Gym: p.Gym, ContentType: "beta_video", ContentID: p.ID, Author: p.User, State: "pending", Files: names,
			Snapshot: map[string]any{"gym": p.Gym, "route": p.Route, "url": p.URL, filesKey: map[string][]string{"file": names}},
		})
		if err != nil || !inserted {
			return err
		}
		if p.File != "" {
			staged := "moderation_items/" + p.ID + "/" + p.File
			if p.FileKey != staged {
				return badRequest("Unexpected staging key.")
			}
			if err := m.copyFile(ctx, w, staged, "moderation_items/"+it.ID+"/"+p.File); err != nil {
				return err
			}
			w.drop = append(w.drop, "moderation_items/"+p.ID)
		}
		if err := publishItem(ctx, w.tx, "create", it); err != nil {
			return err
		}
		staff, err := usersWith(ctx, w.tx, p.Gym, permComments)
		if err != nil {
			return err
		}
		return publishNotify(ctx, w.tx, Notify{
			Type: "moderation_pending", Users: staff, Gym: p.Gym, URL: gymPath(ctx, w.tx, p.Gym, "/manage/moderation"),
		})
	}))
}

var profileFields = kinds["profile"].fields

func (m *module) onUser(e events.Event) {
	var payload struct {
		ID     string `json:"id"`
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
		Changed []string `json:"changed"`
	}
	if json.Unmarshal(e.Payload, &payload) != nil {
		return
	}
	ctx, cancel := handlerContext()
	defer cancel()
	switch e.Kind {
	case "user.updated":
		if payload.Record.ID == "" || !slices.ContainsFunc(payload.Changed, func(f string) bool { return slices.Contains(profileFields, f) }) {
			return
		}
		logFailure("queueing profile", payload.Record.ID, m.inTx(ctx, func(w *work) error {
			_, err := m.queue(ctx, w, "profile", payload.Record.ID, false)
			return err
		}))
	case "user.deleted":
		if payload.ID != "" {
			logFailure("closing reports of deleted profile", payload.ID, m.dropContent(ctx, "profile", payload.ID))
		}
	}
}

func (m *module) onTaskChange(e events.Event) {
	var change struct {
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	if json.Unmarshal(e.Payload, &change) != nil || change.Record.ID == "" {
		return
	}
	ctx, cancel := handlerContext()
	defer cancel()
	switch e.Kind {
	case "task.updated":
		logFailure("re-hiding task", change.Record.ID, m.rehide(ctx, "task", change.Record.ID))
	case "task.deleted":
		logFailure("dropping case", change.Record.ID, m.dropContent(ctx, "task", change.Record.ID))
	}
}

func (m *module) onCompetitionChange(e events.Event) {
	var change struct {
		Kind  string `json:"kind"`
		Entry string `json:"entry"`
	}
	if json.Unmarshal(e.Payload, &change) != nil || change.Kind != "entries" || change.Entry == "" {
		return
	}
	ctx, cancel := handlerContext()
	defer cancel()
	logFailure("re-hiding entry", change.Entry, m.rehide(ctx, "competition_entry", change.Entry))
}

func (m *module) onEntryDeleted(e events.Event) {
	var payload struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(e.Payload, &payload) != nil || payload.ID == "" {
		return
	}
	ctx, cancel := handlerContext()
	defer cancel()
	logFailure("dropping case", payload.ID, m.dropContent(ctx, "competition_entry", payload.ID))
}

var deletedKinds = map[string]string{"rating.deleted": "rating", "beta.deleted": "beta_video", "route.deleted": "route"}

// onGymChange follows review edits and deletions; each change comes in several audience variants, only the public/guest one counts.
func (m *module) onGymChange(e events.Event) {
	if !e.Audience.Public && !e.Audience.GuestsOnly {
		return
	}
	var change struct {
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	if json.Unmarshal(e.Payload, &change) != nil || change.Record.ID == "" {
		return
	}
	id := change.Record.ID
	ctx, cancel := handlerContext()
	defer cancel()
	if kindName, ok := deletedKinds[e.Kind]; ok {
		logFailure("dropping case", id, m.dropContent(ctx, kindName, id))
		if kindName == "route" {
			gym := strings.TrimPrefix(e.Topic, "gym_changes:")
			logFailure("dropping cases of the route's content", id, m.dropOrphans(ctx, gym))
		}
		return
	}
	if e.Kind == "route.updated" {
		logFailure("re-hiding route", id, m.rehide(ctx, "route", id))
		return
	}
	if e.Kind != "rating.updated" {
		return
	}
	// ponytail: without the old row, "comment changed" means "differs from the case snapshot"; a review without a case is always queued.
	logFailure("queueing review", id, m.inTx(ctx, func(w *work) error {
		c, err := loadContent(ctx, w.tx, "rating", id)
		if err != nil || !hasComment(c) {
			return err
		}
		if it, err := itemOf(ctx, w.tx, "rating", id); err == nil && it.Snapshot["comment"] == c.Snapshot["comment"] {
			return nil
		}
		_, err = m.queue(ctx, w, "rating", id, false)
		return err
	}))
}
