package hooks

import (
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Mirrored in shared/utils/betaVideos.ts.
var betaVideoHosts = []string{"youtube.com", "instagram.com", "tiktok.com"}

func registerBetaVideos(app core.App) {
	app.OnRecordCreate("beta_videos").BindFunc(func(e *core.RecordEvent) error {
		if _, err := validateBetaVideo(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordCreateRequest("beta_videos").BindFunc(func(e *core.RecordRequestEvent) error {
		route, err := validateBetaVideo(e.App, e.Record)
		if err != nil {
			return err
		}
		gymID := route.GetString("gym")
		if e.HasSuperuserAuth() || !gymPremoderatesBetas(e.App, gymID) || hasPermission(e.App, e.Auth.Id, gymID, "manage_comments") {
			return e.Next()
		}
		e.Record.Set("gym", gymID)
		if e.Record.Id == "" {
			e.Record.Id = core.GenerateDefaultRandomId()
		}
		// Held uploads skip the save that would validate them, so check type and size here.
		if err := e.App.Validate(e.Record); err != nil {
			return apis.NewBadRequestError("The upload is not a valid beta video.", err)
		}
		if err := holdForApproval(e.App, e.Record); err != nil {
			return err
		}
		pushNotification(e.App, notification{
			Users: usersByPermission(e.App, gymID, "manage_comments"),
			Gym:   gymID,
			Type:  "moderation_pending",
			URL:   gymPath(e.App, gymID, "/manage/moderation"),
		})
		return e.JSON(http.StatusAccepted, map[string]bool{"pending": true})
	})
	app.OnRecordEnrich("beta_videos").BindFunc(func(e *core.RecordEnrichEvent) error {
		if e.RequestInfo != nil && e.RequestInfo.Auth != nil {
			if author, ok := authorOf(e.App, e.Record.GetString("user")); ok {
				e.Record.WithCustomData(true)
				e.Record.Set("author", author.climber)
			}
		}
		return e.Next()
	})
}

func validateBetaVideo(app core.App, video *core.Record) (*core.Record, error) {
	hasFile := len(video.GetUnsavedFiles("file")) > 0
	link := video.GetString("url")
	if hasFile == (link != "") {
		return nil, apis.NewBadRequestError("Add either a link or a video file.", nil)
	}
	if link != "" && !isBetaVideoLink(link) {
		return nil, apis.NewBadRequestError("Only YouTube Shorts, Instagram and TikTok links are allowed.", nil)
	}
	route, err := app.FindRecordById("routes", video.GetString("route"))
	if err != nil {
		return nil, apis.NewBadRequestError("Unknown route.", nil)
	}
	if route.GetBool("archived") {
		return nil, apis.NewBadRequestError("Archived routes take no beta videos.", nil)
	}
	if !gymHasFeature(app, route.GetString("gym"), featureBetaVideos) {
		return nil, apis.NewForbiddenError("Beta videos are not enabled for this gym.", nil)
	}
	return route, nil
}

func gymPremoderatesBetas(app core.App, gymID string) bool {
	gym, err := app.FindRecordById("gyms", gymID)
	return err == nil && gym.GetBool("premoderate_betas")
}

func holdForApproval(app core.App, video *core.Record) error {
	collection, err := app.FindCachedCollectionByNameOrId("moderation_items")
	if err != nil {
		return err
	}
	files := video.GetUnsavedFiles("file")
	names := []string{}
	for _, file := range files {
		names = append(names, file.Name)
	}
	item := core.NewRecord(collection)
	item.Set("gym", video.GetString("gym"))
	item.Set("content_type", "beta_video")
	item.Set("content_id", video.Id)
	item.Set("author", video.GetString("user"))
	item.Set("state", "pending")
	item.Set("snapshot", map[string]any{
		"gym":               video.GetString("gym"),
		"route":             video.GetString("route"),
		"url":               video.GetString("url"),
		quarantinedFilesKey: map[string][]string{"file": names},
	})
	item.Set("files", files)
	return app.Save(item)
}

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
