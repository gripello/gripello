package ticks

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform"
	"gripello/internal/platform/climbers"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/jobs"
	"gripello/internal/platform/tenancy"
)

type module struct {
	app      *platform.App
	perms    *tenancy.Permissions
	climbers *climbers.Lookup
	boards   *boardCache
}

func Register(app *platform.App) { newModule(app) }

func newModule(app *platform.App) *module {
	m := &module{app: app, perms: tenancy.New(app.DB), climbers: climbers.New(app.DB), boards: newBoardCache()}
	for pattern, handler := range map[string]httpx.Handler{
		"GET /me/ticks":               m.listOwnTicks,
		"GET /me/ticks/sends":         m.listSends,
		"POST /me/ticks":              m.postTick,
		"PATCH /ticks/{id}":           m.patchTick,
		"DELETE /ticks/{id}":          m.deleteTickHandler,
		"GET /me/feed":                m.listFeed,
		"GET /climbers/{id}/ticks":    m.listClimberTicks,
		"GET /gyms/{gym}/leaderboard": m.getLeaderboard,
		"GET /gyms/{gym}/seasons":     m.listSeasons,
		"POST /gyms/{gym}/seasons":    m.postSeason,
		"PATCH /seasons/{id}":         m.patchSeason,
		"DELETE /seasons/{id}":        m.deleteSeasonHandler,
	} {
		app.Handle(pattern, handler)
	}
	app.Bus.Subscribe(TopicTickChanged, m.onTickChanged)
	app.Worker(leaderboardJob, m.announceLeaderboard)
	app.Bus.Subscribe("user:", m.onUserEvent)
	app.Bus.SubscribeOnce("gym_changes:", "ticks.route_grades", m.onRouteChange)
	app.Worker(routeGradesJob, m.syncRouteGrades)
	return m
}

var gradeFields = []string{"grade", "grade_system", "grade_index"}

const routeGradesJob = "ticks.route_grades"

// A corrected route grade rewrites the snapshot on its ticks (a coalesced job per route, so a popular route's ticks
// don't run inside the bus handler); ticks keep their own copy only once the route is deleted.
func (m *module) onRouteChange(e events.Event) {
	var change struct {
		Record  struct{ ID string } `json:"record"`
		Changed []string            `json:"changed"`
	}
	if e.Kind != "route.updated" || json.Unmarshal(e.Payload, &change) != nil ||
		!slices.ContainsFunc(change.Changed, func(field string) bool { return slices.Contains(gradeFields, field) }) {
		return
	}
	if err := jobs.Enqueue(context.Background(), m.app.DB, routeGradesJob, change.Record.ID, nil, 0); err != nil {
		slog.Error("ticks: queueing the route grade sync failed", "route", change.Record.ID, "error", err)
	}
}

func (m *module) syncRouteGrades(ctx context.Context, job jobs.Job) error {
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error { return syncRouteGrade(ctx, tx, job.Key) })
}

func syncRouteGrade(ctx context.Context, tx pgx.Tx, route string) error {
	gym := routeGym(ctx, tx, route)
	if gym == "" {
		return nil
	}
	updated, err := queryTicks(ctx, tx, `UPDATE ticks t SET grade = r.grade, grade_system = r.grade_system, grade_index = r.grade_index, updated = now()
		FROM routes r WHERE r.id = $1 AND t.route = r.id
		AND (t.grade, t.grade_system, t.grade_index) IS DISTINCT FROM (r.grade, r.grade_system, r.grade_index)
		RETURNING `+qualifiedTickColumns, route)
	if err != nil || len(updated) == 0 {
		return err
	}
	climbers := make([]string, 0, len(updated))
	for _, tick := range updated {
		climbers = append(climbers, tick.User)
	}
	rows, err := tx.Query(ctx, `SELECT id FROM users WHERE id = ANY($1) AND ticks_private`, climbers)
	if err != nil {
		return err
	}
	private, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	changed := map[TickChanged]bool{}
	for _, tick := range updated {
		if err := publishTickRecord(ctx, tx, "update", tick, slices.Contains(private, tick.User), gym); err != nil {
			return err
		}
		changed[TickChanged{User: tick.User, Route: tick.Route, Gym: gym, Date: tick.Date}] = true
	}
	for change := range changed {
		if err := publishTickChanged(ctx, tx, "update", change); err != nil {
			return err
		}
	}
	return nil
}

func (m *module) onTickChanged(e events.Event) {
	var change TickChanged
	if json.Unmarshal(e.Payload, &change) == nil {
		m.refreshClimber(change.Gym, change.User, change.Route)
		m.queueLeaderboardNews(change)
	}
}

// Every replica sees the tick; the job queue coalesces their enqueues into one announcement per gym and window.
func (m *module) queueLeaderboardNews(change TickChanged) {
	if change.Gym == "" {
		return
	}
	ctx := context.Background()
	var offBoard bool
	err := m.app.DB.QueryRow(ctx, `SELECT leaderboard_hidden OR ticks_private FROM users WHERE id = $1`, change.User).Scan(&offBoard)
	if err != nil || offBoard {
		return
	}
	if err := jobs.Enqueue(ctx, m.app.DB, leaderboardJob, change.Gym, nil, leaderboardWindow); err != nil {
		slog.Error("leaderboard: enqueue failed", "gym", change.Gym, "error", err)
	}
}

// The payload stays empty: boards differ per viewer, so clients refetch them.
func (m *module) announceLeaderboard(ctx context.Context, job jobs.Job) error {
	return pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		return events.Publish(ctx, tx, TopicLeaderboard+job.Key, KindLeaderboardChanged, struct{}{}, events.Audience{Public: true})
	})
}

// user.updated carries {record, changed}; without `changed` every leaderboard field counts as changed.
func (m *module) onUserEvent(e events.Event) {
	if e.Kind == "user.deleted" {
		var deleted struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(e.Payload, &deleted) == nil {
			m.climbers.Forget(deleted.ID)
			m.refreshClimber("", deleted.ID, "")
		}
		return
	}
	if e.Kind != "user.updated" {
		return
	}
	var update struct {
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
		Changed []string `json:"changed"`
	}
	if json.Unmarshal(e.Payload, &update) != nil {
		return
	}
	m.climbers.Forget(update.Record.ID)
	if !touchesLeaderboard(update.Changed) {
		return
	}
	m.boards.markDirty()
	if update.Changed == nil || slices.Contains(update.Changed, "leaderboard_hidden") || slices.Contains(update.Changed, "ticks_private") {
		m.refreshClimber("", update.Record.ID, "")
	}
}
