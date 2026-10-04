package hooks

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

func registerAccountExport(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/account/export", func(e *core.RequestEvent) error {
			user, err := e.App.FindRecordById("users", e.Auth.Id)
			if err != nil {
				return e.NotFoundError("", err)
			}
			var buf bytes.Buffer
			zw := zip.NewWriter(&buf)
			if err := writeAccountExport(e.App, zw, user); err != nil {
				return e.InternalServerError("Exporting your data failed.", err)
			}
			if err := zw.Close(); err != nil {
				return e.InternalServerError("Exporting your data failed.", err)
			}
			filename := "gripello-data-" + time.Now().UTC().Format("2006-01-02") + ".zip"
			e.Response.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
			return e.Blob(http.StatusOK, "application/zip", buf.Bytes())
		}).Bind(apis.RequireAuth("users"))
		return se.Next()
	})
}

type accountExport struct {
	app  core.App
	zw   *zip.Writer
	fsys *filesystem.System
	user *core.Record
	err  error
}

func (x *accountExport) fail(err error) {
	if x.err == nil && err != nil && !errors.Is(err, sql.ErrNoRows) {
		x.err = err
	}
}

func (x *accountExport) byUser(collection, field string) []*core.Record {
	records, err := x.app.FindAllRecords(collection, dbx.HashExp{field: x.user.Id})
	x.fail(err)
	return records
}

func (x *accountExport) find(collection, id string) *core.Record {
	if id == "" {
		return nil
	}
	record, err := x.app.FindRecordById(collection, id)
	x.fail(err)
	return record
}

func (x *accountExport) nameOf(collection, id string) any {
	return fieldOf(x.find(collection, id), "name")
}

func (x *accountExport) expand(records []*core.Record, paths ...string) {
	for _, err := range x.app.ExpandRecords(records, paths, nil) {
		x.fail(err)
	}
}

func (x *accountExport) writeJSON(name string, data any) {
	if x.err != nil {
		return
	}
	w, err := x.zw.Create(name)
	if err != nil {
		x.fail(err)
		return
	}
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	x.fail(encoder.Encode(data))
}

func (x *accountExport) copyFile(key, name string) {
	if x.err != nil {
		return
	}
	if exists, err := x.fsys.Exists(key); err != nil || !exists {
		x.fail(err)
		return
	}
	r, err := x.fsys.GetReader(key)
	if err != nil {
		x.fail(err)
		return
	}
	defer r.Close()
	w, err := x.zw.Create(name)
	if err != nil {
		x.fail(err)
		return
	}
	_, err = io.Copy(w, r)
	x.fail(err)
}

func writeAccountExport(app core.App, zw *zip.Writer, user *core.Record) error {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()
	x := &accountExport{app: app, zw: zw, fsys: fsys, user: user}

	walls, err := app.FindRecordsByIds("walls", user.GetStringSlice("followed_walls"))
	x.fail(err)
	x.expand(walls, "location.gym")
	followedWalls := []map[string]any{}
	for _, wall := range walls {
		location := wall.ExpandedOne("location")
		var gym *core.Record
		if location != nil {
			gym = location.ExpandedOne("gym")
		}
		followedWalls = append(followedWalls, map[string]any{
			"wall":     wall.GetString("name"),
			"location": fieldOf(location, "name"),
			"gym":      fieldOf(gym, "name"),
		})
	}
	user.IgnoreEmailVisibility(true)
	x.writeJSON("profile.json", map[string]any{"user": user, "followed_walls": followedWalls})
	if avatar := user.GetString("avatar"); avatar != "" {
		x.copyFile(user.BaseFilesPath()+"/"+avatar, "avatar"+path.Ext(avatar))
	}

	ticks := x.byUser("ticks", "user")
	x.writeJSON("ticks.json", ticks)
	x.writeLogbookCSV(ticks)

	memberships := []map[string]any{}
	for _, membership := range x.byUser("memberships", "user") {
		gym := x.find("gyms", membership.GetString("gym"))
		role := x.find("roles", membership.GetString("role"))
		permissions := []string{}
		if role != nil {
			x.expand([]*core.Record{role}, "permissions")
			for _, permission := range role.ExpandedAll("permissions") {
				permissions = append(permissions, permission.GetString("name"))
			}
		}
		memberships = append(memberships, map[string]any{
			"gym":         fieldOf(gym, "name"),
			"gym_slug":    fieldOf(gym, "slug"),
			"role":        fieldOf(role, "name"),
			"permissions": permissions,
			"since":       membership.GetDateTime("created"),
		})
	}
	x.writeJSON("memberships.json", memberships)

	entries := []map[string]any{}
	for _, entry := range x.byUser("competition_entries", "user") {
		competition := x.find("competitions", entry.GetString("competition"))
		data := ownFields(entry, "user")
		data["competition"] = fieldOf(competition, "name")
		data["competition_starts_at"] = fieldOf(competition, "starts_at")
		data["category"] = x.nameOf("competition_categories", entry.GetString("category"))
		entries = append(entries, data)
	}
	x.writeJSON("competition_entries.json", entries)

	devices := []map[string]any{}
	for _, subscription := range x.byUser("push_subscriptions", "user") {
		devices = append(devices, map[string]any{"device": subscription.GetString("device"), "created": subscription.GetDateTime("created")})
	}
	x.writeJSON("devices.json", devices)
	x.writeJSON("notifications.json", x.byUser("notifications", "user"))
	x.writeJSON("activity_log.json", x.byUser("audit_logs", "actor"))

	tasks := []map[string]any{}
	for _, relation := range []struct{ field, label string }{{"reporter", "reported"}, {"assignee", "assigned"}, {"done_by", "closed"}} {
		for _, task := range x.byUser("tasks", relation.field) {
			data := ownFields(task, "reporter", "assignee", "done_by")
			data["relation"] = relation.label
			for _, target := range []string{"gym", "location", "wall", "route"} {
				data[target] = x.nameOf(target+"s", task.GetString(target))
			}
			tasks = append(tasks, data)
			if photo := task.GetString("photo"); relation.field == "reporter" && photo != "" {
				x.copyFile(task.BaseFilesPath()+"/"+photo, "task_photos/"+task.Id+"_"+photo)
			}
		}
	}
	x.writeJSON("tasks.json", tasks)

	reports := []map[string]any{}
	if user.Verified() {
		records, err := app.FindAllRecords("reports", dbx.NewExp("LOWER(notifier_email) = {:email}", dbx.Params{"email": strings.ToLower(user.Email())}))
		x.fail(err)
		for _, report := range records {
			reports = append(reports, ownFields(report, "decided_by"))
		}
	}
	x.writeJSON("reports.json", reports)
	return x.err
}

func fieldOf(record *core.Record, field string) any {
	if record == nil {
		return nil
	}
	return record.Get(field)
}

func ownFields(record *core.Record, otherUserFields ...string) map[string]any {
	data := record.PublicExport()
	delete(data, "collectionId")
	delete(data, "collectionName")
	for _, field := range otherUserFields {
		delete(data, field)
	}
	return data
}

func (x *accountExport) writeLogbookCSV(ticks []*core.Record) {
	x.expand(ticks, "route.gym")
	if x.err != nil {
		return
	}
	w, err := x.zw.Create("logbook.csv")
	if err != nil {
		x.fail(err)
		return
	}
	out := csv.NewWriter(w)
	out.Write([]string{"date", "route", "grade", "grade_system", "type", "attempts", "note", "gym"})
	for _, tick := range ticks {
		name, gym := tick.GetString("route_name"), ""
		if route := tick.ExpandedOne("route"); route != nil {
			if name == "" {
				name = route.GetString("name")
			}
			if g := route.ExpandedOne("gym"); g != nil {
				gym = g.GetString("name")
			}
		}
		out.Write([]string{
			tick.GetDateTime("date").Time().Format(time.DateOnly),
			name,
			tick.GetString("grade"),
			tick.GetString("grade_system"),
			tick.GetString("type"),
			strconv.Itoa(tick.GetInt("attempts")),
			tick.GetString("note"),
			gym,
		})
	}
	out.Flush()
	x.fail(out.Error())
}
