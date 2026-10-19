package gyms

import (
	"context"
	"encoding/json"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/ids"
)

func (m *module) listGyms(w http.ResponseWriter, r *http.Request) error {
	p, _ := auth.From(r.Context())
	items, err := listGyms(r.Context(), m.db, r.URL.Query().Get("all") == "1" && p.PlatformAdmin, p.UserID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (m *module) getGym(w http.ResponseWriter, r *http.Request) error {
	p, _ := auth.From(r.Context())
	gym, err := findGym(r.Context(), m.db, r.PathValue("gym"), p.UserID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, gym)
	return nil
}

func (m *module) createGym(w http.ResponseWriter, r *http.Request) error {
	p, err := requirePlatformAdmin(r.Context())
	if err != nil {
		return err
	}
	body, files, err := readBody(w, r)
	if err != nil {
		return err
	}
	changes, err := validateFields(body, gymFields, true)
	if err != nil {
		return err
	}
	gym, err := m.saveGym(r.Context(), p.UserID, ids.New(), nil, changes, files, nil)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, gym)
	return nil
}

func (m *module) updateGym(w http.ResponseWriter, r *http.Request) error {
	p, err := auth.Require(r.Context())
	if err != nil {
		return err
	}
	current, err := loadGym(r.Context(), m.db, r.PathValue("gym"))
	if err != nil {
		return err
	}
	if !canManageGym(r.Context(), m.perms, p, current.ID) {
		return httpx.ErrForbidden
	}
	body, files, err := readBody(w, r)
	if err != nil {
		return err
	}
	if !p.PlatformAdmin {
		if message := platformOnlyChange(body, current); message != "" {
			return httpx.NewError(http.StatusForbidden, message)
		}
	}
	changes, err := validateFields(body, gymFields, false)
	if err != nil {
		return err
	}
	if _, ok := changes["trial_ends_at"]; ok {
		if trialChanged(current.TrialEndsAt, body["trial_ends_at"]) {
			changes["trial_notice"] = 0
		} else {
			delete(changes, "trial_ends_at")
		}
	}
	gym, err := m.saveGym(r.Context(), p.UserID, current.ID, current, changes, files, nil)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, gym)
	return nil
}

func (m *module) deleteGym(w http.ResponseWriter, r *http.Request) error {
	p, err := requirePlatformAdmin(r.Context())
	if err != nil {
		return err
	}
	gym, err := loadGym(r.Context(), m.db, r.PathValue("gym"))
	if err != nil {
		return err
	}
	var dirs []string
	err = pgx.BeginFunc(r.Context(), m.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `SELECT 1 FROM gyms WHERE id = $1 FOR UPDATE`, gym.ID); err != nil {
			return err
		}
		if gym, err = loadGym(r.Context(), tx, gym.ID); err != nil {
			return err
		}
		if dirs, err = gymBlobDirs(r.Context(), tx, gym.ID); err != nil {
			return err
		}
		if err := deleteGym(r.Context(), tx, gym); err != nil {
			return err
		}
		return publishGym(r.Context(), tx, p.UserID, kindGymDeleted, gym.ID, gym.Active && !gym.Hidden, gymDeleted{ID: gym.ID, Slug: gym.Slug})
	})
	if err != nil {
		return err
	}
	if m.blob != nil {
		for _, dir := range dirs {
			if err := m.blob.Delete(context.WithoutCancel(r.Context()), dir); err != nil {
				slog.Warn("gyms: deleting files of a deleted gym failed", "gym", gym.ID, "key", dir, "error", err)
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) getSettings(w http.ResponseWriter, r *http.Request) error {
	settings, err := settingsJSON(r.Context(), m.db)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, settings)
	return nil
}

func (m *module) updateSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := requirePlatformAdmin(r.Context()); err != nil {
		return err
	}
	var body map[string]json.RawMessage
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	changes, err := validateFields(body, settingsFields, false)
	if err != nil {
		return err
	}
	if _, err := settingsJSON(r.Context(), m.db); err != nil {
		return err
	}
	if err := updateRow(r.Context(), m.db, "settings", settingsID, changes); err != nil {
		return err
	}
	settings, err := settingsJSON(r.Context(), m.db)
	if err != nil {
		return err
	}
	// every client keeps the public settings (registration, legal pages) and patches them in place
	err = pgx.BeginFunc(r.Context(), m.db, func(tx pgx.Tx) error {
		return events.Publish(r.Context(), tx, TopicSettings, "settings.updated", settings, events.Audience{Public: true})
	})
	if err != nil {
		slog.Warn("gyms: settings change not announced", "error", err)
	}
	httpx.JSON(w, http.StatusOK, settings)
	return nil
}

func (m *module) listPermissions(w http.ResponseWriter, r *http.Request) error {
	if _, err := auth.Require(r.Context()); err != nil {
		return err
	}
	items, err := listPermissions(r.Context(), m.db)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

// alsoInTx runs inside the write transaction of a new gym, after its roles are seeded.
func (m *module) saveGym(ctx context.Context, actor, id string, current *gymState, changes map[string]any, files map[string]*multipart.FileHeader, alsoInTx func(pgx.Tx) error) (json.RawMessage, error) {
	slug, previous := slugHistory(current, changes)
	if current == nil || slug != current.Slug {
		taken, err := slugTaken(ctx, m.db, id, slug)
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, httpx.NewError(http.StatusBadRequest, "This slug was used by another gym.").
				Field("slug", "validation_slug_used", "This slug was used by another gym.")
		}
	}
	if current == nil || !slices.Equal(previous, current.PreviousSlugs) {
		for _, added := range previous {
			if current != nil && (added == current.Slug || slices.Contains(current.PreviousSlugs, added)) {
				continue
			}
			taken, err := slugTaken(ctx, m.db, id, added)
			if err != nil {
				return nil, err
			}
			if message := validateGymSlug(added); message != "" || taken {
				return nil, httpx.NewError(http.StatusBadRequest, "Previous slugs must be valid slugs no other gym uses.").
					Field("previous_slugs", "validation_invalid_previous_slugs", "Previous slugs must be valid slugs no other gym uses.")
			}
		}
		changes["previous_slugs"] = previous
	}
	uploaded, err := m.storeFiles(ctx, id, files, changes)
	var gym json.RawMessage
	if err == nil {
		gym, err = m.writeGym(ctx, actor, id, slug, current == nil, changes, alsoInTx)
	}
	if err != nil {
		for _, name := range uploaded {
			m.deleteBlob(ctx, id, name)
		}
		return nil, err
	}
	for field := range files {
		m.blob.WarmThumbs(blobKey(id, changes[field].(string)), thumbs[field]...)
	}
	if current != nil {
		for field, old := range current.Files {
			if replaced, ok := changes[field]; ok && old != "" && replaced != old {
				m.deleteBlob(ctx, id, old)
			}
		}
	}
	return gym, nil
}

func (m *module) writeGym(ctx context.Context, actor, id, slug string, creating bool, changes map[string]any, alsoInTx func(pgx.Tx) error) (gym json.RawMessage, err error) {
	err = pgx.BeginFunc(ctx, m.db, func(tx pgx.Tx) error {
		kind := kindGymUpdated
		if creating {
			kind = kindGymCreated
			if err := insertGym(ctx, tx, id, slug, changes["name"].(string)); err != nil {
				return err
			}
			if err := seedRoles(ctx, tx, id); err != nil {
				return err
			}
		}
		if err := updateRow(ctx, tx, "gyms", id, changes); err != nil {
			return err
		}
		if alsoInTx != nil {
			if err := alsoInTx(tx); err != nil {
				return err
			}
		}
		if gym, err = gymJSON(ctx, tx, id); err != nil {
			return err
		}
		var state struct{ Active bool }
		if err := json.Unmarshal(gym, &state); err != nil {
			return err
		}
		if endsAt, ok := changes["trial_ends_at"]; ok && !creating {
			if err := publishTrial(ctx, tx, actor, id, endsAt); err != nil {
				return err
			}
		}
		public, err := publicGymJSON(ctx, tx, id)
		if err != nil {
			return err
		}
		return publishGym(ctx, tx, actor, kind, id, state.Active, map[string]json.RawMessage{"record": public})
	})
	return gym, err
}

// readBody accepts JSON or multipart (file parts plus the other fields as JSON in `@jsonPayload`).
func readBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, map[string]*multipart.FileHeader, error) {
	body := map[string]json.RawMessage{}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		return body, nil, httpx.Decode(r, &body)
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4*maxFileSize+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		return nil, nil, httpx.NewError(http.StatusBadRequest, "Invalid multipart body.")
	}
	if payload := r.FormValue("@jsonPayload"); payload != "" {
		if err := json.Unmarshal([]byte(payload), &body); err != nil {
			return nil, nil, httpx.NewError(http.StatusBadRequest, "Invalid JSON body.")
		}
	}
	files := map[string]*multipart.FileHeader{}
	for name, headers := range r.MultipartForm.File {
		if _, ok := fileTypes[name]; ok && len(headers) > 0 {
			files[name] = headers[0]
		}
	}
	return body, files, nil
}

func (m *module) storeFiles(ctx context.Context, gymID string, files map[string]*multipart.FileHeader, changes map[string]any) ([]string, error) {
	if len(files) == 0 {
		return nil, nil
	}
	if m.blob == nil {
		return nil, httpx.NewError(http.StatusBadRequest, "File uploads are not available.")
	}
	var stored []string
	for field, header := range files {
		file, err := header.Open()
		if err != nil {
			return stored, err
		}
		name, err := m.blob.Upload(ctx, blobKey(gymID, path.Base(header.Filename)), file, fileTypes[field], maxFileSize)
		file.Close()
		if err != nil {
			return stored, err
		}
		stored = append(stored, name)
		changes[field] = name
	}
	return stored, nil
}

func blobKey(gymID, name string) string { return "gyms/" + gymID + "/" + name }

func (m *module) deleteBlob(ctx context.Context, gymID, name string) {
	if m.blob == nil || name == "" {
		return
	}
	if err := m.blob.Delete(ctx, blobKey(gymID, name)); err != nil {
		slog.Warn("gyms: deleting file failed", "gym", gymID, "file", name, "error", err)
	}
}
