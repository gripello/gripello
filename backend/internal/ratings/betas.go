package ratings

import (
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
	"gripello/internal/platform/tenancy"
)

const maxBetaBytes = 30 << 20

// Mirrored in shared/utils/betaVideos.ts.
var (
	betaVideoHosts = []string{"youtube.com", "instagram.com", "tiktok.com"}
	betaVideoTypes = []string{"video/mp4", "video/webm", "video/quicktime"}
)

func isBetaVideoLink(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
	host = strings.TrimPrefix(strings.TrimPrefix(host, "m."), "vm.")
	if host == "youtube.com" && !strings.HasPrefix(parsed.Path, "/shorts/") {
		return false
	}
	return slices.Contains(betaVideoHosts, host)
}

func betaKey(id, file string) string { return "beta_videos/" + id + "/" + file }

// stagedKey keeps a held upload behind file tokens until moderation approves it.
func stagedKey(id, file string) string { return "moderation_items/" + id + "/" + file }

func (m *module) listBetas(w http.ResponseWriter, r *http.Request) error {
	where := &db.Where{}
	where.Add("route = ?", r.PathValue("id"))
	where.Add("gym_visible(gym, ?)", auth.UserID(r.Context()))
	items, err := queryBetas(r.Context(), m.app.DB, where, "")
	if err != nil {
		return err
	}
	if err := m.enrichBetas(r.Context(), items); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": items}, nil)
}

func (m *module) listGymBetas(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	gym, err := tenancy.ResolveGym(ctx, m.app.DB, r.PathValue("gym"))
	if err != nil {
		return err
	}
	include := r.URL.Query().Get("include")
	if include != "" && include != "route" {
		return httpx.Invalid("include", "Unknown include "+include+".")
	}
	page := httpx.Page(r, defaultPageSize, maxPageSize)
	where := &db.Where{}
	where.Add("gym = ?", gym)
	items, err := queryBetas(ctx, m.app.DB, where, page.SQL())
	if err != nil {
		return err
	}
	if err := m.enrichBetas(ctx, items); err != nil {
		return err
	}
	if include == "route" {
		if err := m.expandBetaRoutes(ctx, items); err != nil {
			return err
		}
	}
	return httpx.Respond(w, http.StatusOK, map[string]any{"items": items, "page": page.Page, "limit": page.Limit}, nil)
}

// expandBetaRoutes fills expand.route with the routes row.
func (m *module) expandBetaRoutes(ctx context.Context, items []BetaVideo) error {
	routeIDs := make([]string, len(items))
	for i, b := range items {
		routeIDs[i] = b.Route
	}
	rows, err := m.app.DB.Query(ctx, `SELECT id, to_jsonb(r) FROM routes r WHERE id = ANY ($1)`, routeIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	routes := map[string]json.RawMessage{}
	for rows.Next() {
		var id string
		var route json.RawMessage
		if err := rows.Scan(&id, &route); err != nil {
			return err
		}
		routes[id] = route
	}
	for i, b := range items {
		if route, ok := routes[b.Route]; ok {
			items[i].Expand = map[string]any{"route": route}
		}
	}
	return rows.Err()
}

func (m *module) postBeta(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	viewer, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	route, err := findRoute(ctx, m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := tenancy.RequireGym(ctx, m.app.DB, route.Gym); err != nil {
		return err
	}
	if route.Archived {
		return httpx.BadRequest("Archived routes take no beta videos.")
	}
	links, uploads, premoderate, err := gymBetaSettings(ctx, m.app.DB, route.Gym)
	if err != nil {
		return err
	}
	if !uploads && isMultipart(r) {
		return httpx.NewError(http.StatusForbidden, "Beta video uploads are not enabled for this gym.")
	}
	link, file, err := betaSubmission(w, r)
	if err != nil {
		return err
	}
	if file != nil {
		defer file.Close()
	}
	if (file != nil) == (link != "") {
		return httpx.BadRequest("Add either a link or a video file.")
	}
	if link != "" && !isBetaVideoLink(link) {
		return httpx.Invalid("url", "Only YouTube Shorts, Instagram and TikTok links are allowed.")
	}
	if link != "" && !links {
		return httpx.NewError(http.StatusForbidden, "Beta video links are not enabled for this gym.")
	}
	beta := BetaVideo{ID: ids.New(), Gym: route.Gym, Route: route.ID, User: viewer.UserID, URL: link}
	if premoderate && !m.perms.Has(ctx, route.Gym, tenancy.PermManageComments) {
		pending := BetaPending{ID: beta.ID, Gym: beta.Gym, Route: beta.Route, User: beta.User, URL: beta.URL}
		if file != nil {
			if pending.File, err = m.app.Blob.Upload(ctx, stagedKey(beta.ID, file.name), file, betaVideoTypes, maxBetaBytes); err != nil {
				return err
			}
			pending.FileKey = stagedKey(beta.ID, pending.File)
		}
		err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
			return events.PublishAs(ctx, tx, auth.UserID(ctx), TopicBetaPending, TopicBetaPending, pending, events.Audience{})
		})
		if err != nil {
			if file != nil {
				m.app.Blob.Delete(ctx, "moderation_items/"+beta.ID)
			}
			return err
		}
		return httpx.Respond(w, http.StatusAccepted, map[string]bool{"pending": true}, nil)
	}
	if file != nil {
		if beta.File, err = m.app.Blob.Upload(ctx, betaKey(beta.ID, file.name), file, betaVideoTypes, maxBetaBytes); err != nil {
			return err
		}
	}
	var saved BetaVideo
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := insertBeta(ctx, tx, beta); err != nil {
			return err
		}
		if saved, err = findBeta(ctx, tx, beta.ID); err != nil {
			return err
		}
		if err := events.PublishAs(ctx, tx, auth.UserID(ctx), TopicBetaCreated, TopicBetaCreated,
			BetaCreated{ID: saved.ID, Gym: saved.Gym, Route: saved.Route, User: saved.User}, events.Audience{}); err != nil {
			return err
		}
		return m.publishBetaChange(ctx, tx, auth.UserID(ctx), "create", saved)
	})
	if err != nil {
		m.dropUpload(ctx, beta)
		return err
	}
	items := []BetaVideo{saved}
	if err := m.enrichBetas(ctx, items); err != nil {
		return err
	}
	return httpx.Respond(w, http.StatusCreated, items[0], nil)
}

type namedFile struct {
	multipart.File
	name string
}

func isMultipart(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/")
}

// betaSubmission reads JSON {url} or a multipart form with `file` (and optionally `url`, which then fails the either-or check).
func betaSubmission(w http.ResponseWriter, r *http.Request) (string, *namedFile, error) {
	if !isMultipart(r) {
		var body struct {
			URL string `json:"url"`
		}
		if err := httpx.Decode(r, &body); err != nil {
			return "", nil, err
		}
		return strings.TrimSpace(body.URL), nil, nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBetaBytes+1<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		return "", nil, httpx.NewError(http.StatusRequestEntityTooLarge, "The file is too large.")
	}
	if err := httpx.CheckForm(r); err != nil {
		return "", nil, err
	}
	link := strings.TrimSpace(r.FormValue("url"))
	file, header, err := r.FormFile("file")
	if err != nil {
		return link, nil, nil
	}
	return link, &namedFile{File: file, name: header.Filename}, nil
}

func (m *module) dropUpload(ctx context.Context, beta BetaVideo) {
	if beta.File != "" {
		m.app.Blob.Delete(ctx, "beta_videos/"+beta.ID)
	}
}

func (m *module) deleteBeta(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	viewer, err := auth.Require(ctx)
	if err != nil {
		return err
	}
	beta, err := findBeta(ctx, m.app.DB, r.PathValue("id"))
	if err != nil {
		return err
	}
	if beta.User != viewer.UserID && !m.perms.Has(ctx, beta.Gym, tenancy.PermManageComments) {
		return httpx.ErrForbidden
	}
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if err := deleteRow(ctx, tx, "beta_videos", beta.ID); err != nil {
			return err
		}
		return m.publishBetaChange(ctx, tx, auth.UserID(ctx), "delete", beta)
	})
	if err != nil {
		return err
	}
	m.dropUpload(ctx, beta)
	return httpx.NoContent(w, nil)
}
