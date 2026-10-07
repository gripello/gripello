package hooks

import (
	"encoding/json"
	"slices"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

const (
	openDefectsTopic  = "open_route_defects"
	ownTicksTopic     = "own_ticks"
	ownNotifications  = "own_notifications"
	competitionsTopic = "competition_changes"
	gymChangesPrefix  = "gym_changes:"
)

var gymChangeCollections = []string{"routes", "walls", "locations", "ratings", "beta_videos"}

type gymChange struct {
	Collection string         `json:"collection"`
	Action     string         `json:"action"`
	Record     map[string]any `json:"record"`
}

var competitionChangeKinds = map[string]string{
	"competitions":           "competition",
	"competition_routes":     "routes",
	"competition_categories": "categories",
	"competition_entries":    "entries",
	"competition_scores":     "scores",
}

type competitionChange struct {
	Competition string `json:"competition"`
	Gym         string `json:"gym"`
	Kind        string `json:"kind"`
	User        string `json:"user,omitempty"`
	Entry       string `json:"entry,omitempty"`
	At          int64  `json:"at"`
}

type openDefect struct {
	ID       string `json:"id"`
	Route    string `json:"route"`
	Category string `json:"category"`
	Created  string `json:"created"`
}

type openDefectsChange struct {
	Gym     string       `json:"gym"`
	Routes  []string     `json:"routes"`
	Defects []openDefect `json:"defects"`
}

type ownRecordChange struct {
	Action string         `json:"action"`
	Record map[string]any `json:"record"`
}

func registerLive(app core.App) {
	onDefectChange := func(e *core.RecordEvent) error {
		if routes := defectRoutes(e.Record); len(routes) > 0 {
			broadcastOpenDefects(e.App, e.Record.GetString("gym"), routes)
		}
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("tasks").BindFunc(onDefectChange)
	app.OnRecordAfterUpdateSuccess("tasks").BindFunc(onDefectChange)
	app.OnRecordAfterDeleteSuccess("tasks").BindFunc(onDefectChange)

	onTickChange := func(action string) func(e *core.RecordEvent) error {
		return func(e *core.RecordEvent) error {
			userID := e.Record.GetString("user")
			broadcast(e.App, ownTicksTopic, ownRecordChange{Action: action, Record: e.Record.PublicExport()}, func(auth *core.Record) bool {
				return auth != nil && auth.Id == userID
			})
			return e.Next()
		}
	}
	app.OnRecordAfterCreateSuccess("ticks").BindFunc(onTickChange("create"))
	app.OnRecordAfterUpdateSuccess("ticks").BindFunc(onTickChange("update"))
	app.OnRecordAfterDeleteSuccess("ticks").BindFunc(onTickChange("delete"))

	onNotificationChange := func(action string) func(e *core.RecordEvent) error {
		return func(e *core.RecordEvent) error {
			userID := e.Record.GetString("user")
			broadcast(e.App, ownNotifications, ownRecordChange{Action: action, Record: e.Record.PublicExport()}, func(auth *core.Record) bool {
				return auth != nil && auth.Id == userID
			})
			return e.Next()
		}
	}
	app.OnRecordAfterCreateSuccess("notifications").BindFunc(onNotificationChange("create"))
	app.OnRecordAfterUpdateSuccess("notifications").BindFunc(onNotificationChange("update"))
	app.OnRecordAfterDeleteSuccess("notifications").BindFunc(onNotificationChange("delete"))

	onCompetitionChange := func(e *core.RecordEvent) error {
		change := competitionChangeOf(e.Record)
		competition := e.Record
		if e.Record.Collection().Name != "competitions" {
			found, err := e.App.FindRecordById("competitions", change.Competition)
			if err != nil {
				return e.Next()
			}
			competition = found
		}
		change.Gym = competition.GetString("gym")
		change.At = time.Now().UnixMilli()
		broadcastCompetitionChange(e.App, change, competitionAudience(e.App, change.Gym, competition.GetString("status") == "draft"))
		return e.Next()
	}
	for collection := range competitionChangeKinds {
		app.OnRecordAfterCreateSuccess(collection).BindFunc(onCompetitionChange)
		app.OnRecordAfterUpdateSuccess(collection).BindFunc(onCompetitionChange)
		app.OnRecordAfterDeleteSuccess(collection).BindFunc(onCompetitionChange)
	}

	onGymChange := func(action string) func(e *core.RecordEvent) error {
		return func(e *core.RecordEvent) error {
			broadcastGymChange(e.App, action, e.Record)
			return e.Next()
		}
	}
	for _, collection := range gymChangeCollections {
		app.OnRecordAfterCreateSuccess(collection).BindFunc(onGymChange("create"))
		app.OnRecordAfterUpdateSuccess(collection).BindFunc(onGymChange("update"))
		app.OnRecordAfterDeleteSuccess(collection).BindFunc(onGymChange("delete"))
	}
}

// broadcastGymChange sends a gym's public changes to that gym's subscribers, one payload per audience.
func broadcastGymChange(app core.App, action string, record *core.Record) {
	gymID := record.GetString("gym")
	if gymID == "" {
		return
	}
	topic := gymChangesPrefix + gymID
	collection := record.Collection().Name
	change := func(extra map[string]any) gymChange {
		export := record.Fresh().PublicExport()
		for key, value := range extra {
			export[key] = value
		}
		return gymChange{Collection: collection, Action: action, Record: export}
	}
	if collection != "ratings" && collection != "beta_videos" {
		broadcast(app, topic, change(nil), nil)
		return
	}
	authorID := record.GetString("user")
	signedIn := map[string]any{}
	if author, ok := authorOf(app, authorID); ok && (collection == "beta_videos" || !author.anonymous) {
		signedIn["author"] = author.climber
	}
	broadcast(app, topic, change(nil), func(auth *core.Record) bool { return auth == nil })
	if collection == "beta_videos" {
		broadcast(app, topic, change(signedIn), func(auth *core.Record) bool { return auth != nil })
		return
	}
	broadcast(app, topic, change(merged(signedIn, "mine", false)), func(auth *core.Record) bool { return auth != nil && auth.Id != authorID })
	broadcast(app, topic, change(merged(signedIn, "mine", true)), func(auth *core.Record) bool { return auth != nil && auth.Id == authorID })
}

func merged(fields map[string]any, key string, value any) map[string]any {
	out := map[string]any{key: value}
	for k, v := range fields {
		out[k] = v
	}
	return out
}

func broadcastCompetitionChange(app core.App, change competitionChange, audience func(auth *core.Record) bool) {
	topic := competitionsTopic + ":" + change.Competition
	if change.User == "" {
		broadcast(app, topic, change, audience)
		return
	}
	owner := change.User
	broadcast(app, topic, change, func(auth *core.Record) bool {
		return auth != nil && auth.Id == owner && audience(auth)
	})
	broadcast(app, topic, publicCompetitionChange(change), func(auth *core.Record) bool {
		return (auth == nil || auth.Id != owner) && audience(auth)
	})
}

func competitionAudience(app core.App, gymID string, draft bool) func(auth *core.Record) bool {
	return func(auth *core.Record) bool {
		if !draft {
			return true
		}
		return auth != nil && (hasPermission(app, auth.Id, gymID, "manage_competitions") || hasPermission(app, auth.Id, gymID, "judge_competitions"))
	}
}

func publicCompetitionChange(change competitionChange) competitionChange {
	change.User = ""
	change.Entry = ""
	return change
}

func competitionChangeOf(record *core.Record) competitionChange {
	collection := record.Collection().Name
	change := competitionChange{Kind: competitionChangeKinds[collection]}
	if collection == "competitions" {
		change.Competition = record.Id
	} else {
		change.Competition = record.GetString("competition")
	}
	switch collection {
	case "competition_entries":
		change.User = record.GetString("user")
		change.Entry = record.Id
	case "competition_scores":
		change.Entry = record.GetString("entry")
	}
	return change
}

func defectRoutes(task *core.Record) []string {
	if task.GetString("kind") != "defect" {
		return nil
	}
	routes := []string{}
	for _, route := range []string{task.GetString("route"), task.Original().GetString("route")} {
		if route != "" && !slices.Contains(routes, route) {
			routes = append(routes, route)
		}
	}
	return routes
}

func broadcastOpenDefects(app core.App, gymID string, routes []string) {
	defects := []openDefect{}
	for _, route := range routes {
		records, err := app.FindRecordsByFilter(openDefectsTopic, "route = {:route}", "", 0, 0, dbx.Params{"route": route})
		if err != nil {
			app.Logger().Error("live: failed to load open defects", "route", route, "error", err)
			return
		}
		for _, record := range records {
			defects = append(defects, openDefect{
				ID:       record.Id,
				Route:    record.GetString("route"),
				Category: record.GetString("category"),
				Created:  record.GetString("created"),
			})
		}
	}
	broadcast(app, openDefectsTopic+":"+gymID, openDefectsChange{Gym: gymID, Routes: routes, Defects: defects}, nil)
}

func broadcast(app core.App, topic string, data any, accept func(auth *core.Record) bool) {
	payload, err := json.Marshal(data)
	if err != nil {
		app.Logger().Error("live: failed to encode message", "topic", topic, "error", err)
		return
	}
	message := subscriptions.Message{Name: topic, Data: payload}
	go sendToSubscribers(app.SubscriptionsBroker().Clients(), topic, message, accept)
}

func sendToSubscribers(clients map[string]subscriptions.Client, topic string, message subscriptions.Message, accept func(auth *core.Record) bool) {
	for _, client := range clients {
		if !client.HasSubscription(topic) {
			continue
		}
		if accept != nil {
			auth, _ := client.Get(apis.RealtimeClientAuthKey).(*core.Record)
			if !accept(auth) {
				continue
			}
		}
		client.Send(message)
	}
}
