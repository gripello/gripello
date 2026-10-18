package backups

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/auth"
	"gripello/internal/platform/db"
	"gripello/internal/platform/events"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/jobs"
)

// The name regex is the only gate between the URL and the file system.
var archiveName = regexp.MustCompile(`^gripello-\d{8}-\d{6}\.tar$`)

type archive struct {
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	Created time.Time `json:"created"`
}

type settings struct {
	Keep           int  `json:"keep"`
	IncludeStorage bool `json:"include_storage"`
	Hour           int  `json:"hour"`
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func loadSettings(ctx context.Context, q querier) (settings, error) {
	var s settings
	err := q.QueryRow(ctx, `SELECT keep, include_storage, hour FROM backup_settings`).Scan(&s.Keep, &s.IncludeStorage, &s.Hour)
	return s, err
}

// runAndRecord keeps the outcome of the last run for the page; a failed run still fails the job.
func (m *module) runAndRecord(ctx context.Context) error {
	err := m.run(ctx)
	message := ""
	if err != nil {
		message = err.Error()
	}
	if _, recordErr := m.app.DB.Exec(context.WithoutCancel(ctx), `UPDATE backup_settings SET last_run = now(), last_error = $1`, message); recordErr != nil && err == nil {
		return recordErr
	}
	return err
}

// archives lists the finished backups, newest first.
func archives(dir string) ([]archive, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []archive{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []archive{}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !entry.Type().IsRegular() || !archiveName.MatchString(entry.Name()) {
			continue
		}
		out = append(out, archive{Name: entry.Name(), Size: info.Size(), Created: info.ModTime()})
	}
	slices.SortFunc(out, func(a, b archive) int { return strings.Compare(b.Name, a.Name) })
	return out, nil
}

// prune keeps the newest keep archives (names sort by time) and drops partial files of crashed runs.
func prune(dir string, keep int) error {
	list, err := archives(dir)
	if err != nil {
		return err
	}
	for _, old := range list[min(keep, len(list)):] {
		if err := os.Remove(filepath.Join(dir, old.Name)); err != nil {
			return err
		}
	}
	partials, _ := filepath.Glob(filepath.Join(dir, "*.tar.partial"))
	for _, partial := range partials {
		if info, err := os.Stat(partial); err == nil && time.Since(info.ModTime()) > 24*time.Hour {
			os.Remove(partial)
		}
	}
	return nil
}

// run dumps the database with pg_dump and packs it, plus storage without regenerable thumbnails, into one tar.
func (m *module) run(ctx context.Context) error {
	s, err := loadSettings(ctx, m.app.DB)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(m.dir, 0o750); err != nil {
		return err
	}
	// Only one backup runs at a time (the job coalesces), so any .work-* left now is from a killed run and holds a plaintext dump.
	stale, _ := filepath.Glob(filepath.Join(m.dir, ".work-*"))
	for _, dir := range stale {
		os.RemoveAll(dir)
	}
	work, err := os.MkdirTemp(m.dir, ".work-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	dump := filepath.Join(work, "database.dump")
	env, err := db.CommandEnv(m.app.Cfg.DatabaseURL)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, "pg_dump", "--format=custom", "--no-owner", "--file="+dump)
	cmd.Env = append(os.Environ(), env...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("pg_dump: %w: %s", err, out)
	}
	name := "gripello-" + time.Now().UTC().Format("20060102-150405") + ".tar"
	partial := filepath.Join(m.dir, name+".partial")
	if err := writeArchive(partial, dump, m.app.Cfg.BlobDir, s.IncludeStorage); err != nil {
		os.Remove(partial)
		return err
	}
	if err := os.Rename(partial, filepath.Join(m.dir, name)); err != nil {
		return err
	}
	// The archive is complete from here on: later failures are logged, a job retry would only write another archive.
	if s.Keep > 0 {
		if err := prune(m.dir, s.Keep); err != nil {
			slog.Warn("backups: pruning old archives failed", "error", err)
		}
	}
	if err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		return events.PublishAs(ctx, tx, "", "platform", "backup.created", map[string]string{"id": name}, events.Audience{PlatformAdmins: true})
	}); err != nil {
		slog.Warn("backups: recording the archive failed", "archive", name, "error", err)
	}
	return nil
}

func writeArchive(path, dump, storage string, includeStorage bool) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	defer f.Close()
	tw := tar.NewWriter(f)
	if err := addFile(tw, dump, "database.dump"); err != nil {
		return err
	}
	if includeStorage {
		err := filepath.WalkDir(storage, func(path string, entry fs.DirEntry, err error) error {
			// A file deleted while the walk runs (gym delete, moderation hide) is skipped, not fatal.
			if errors.Is(err, fs.ErrNotExist) && path != storage {
				return nil
			}
			if err != nil {
				return err
			}
			if entry.IsDir() && strings.HasPrefix(entry.Name(), "thumbs_") {
				return filepath.SkipDir
			}
			if !entry.Type().IsRegular() {
				return nil
			}
			rel, err := filepath.Rel(storage, path)
			if err != nil {
				return err
			}
			if err := addFile(tw, path, "storage/"+filepath.ToSlash(rel)); !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			return nil
		})
		if err != nil && !(errors.Is(err, fs.ErrNotExist) && !dirExists(storage)) {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return f.Sync()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func addFile(tw *tar.Writer, path, name string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	header, err := tar.FileInfoHeader(info, "")
	if err != nil {
		return err
	}
	header.Name = name
	if err := tw.WriteHeader(header); err != nil {
		return err
	}
	_, err = io.Copy(tw, f)
	return err
}

func (m *module) list(w http.ResponseWriter, r *http.Request) error {
	if m.dir == "" {
		httpx.JSON(w, http.StatusOK, map[string]any{"enabled": false, "items": []archive{}})
		return nil
	}
	items, err := archives(m.dir)
	if err != nil {
		return err
	}
	s, err := loadSettings(r.Context(), m.app.DB)
	if err != nil {
		return err
	}
	var running bool
	var lastRun *time.Time
	var lastError string
	if err := m.app.DB.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM jobs WHERE kind = $1), last_run, last_error FROM backup_settings`, jobKind).
		Scan(&running, &lastRun, &lastError); err != nil {
		return err
	}
	_, missing := exec.LookPath("pg_dump")
	out := map[string]any{"enabled": true, "items": items, "running": running, "settings": s,
		"last_run": lastRun, "last_error": lastError, "pg_dump": missing == nil, "dir": m.dir}
	var disk syscall.Statfs_t
	if err := syscall.Statfs(m.dir, &disk); err == nil || syscall.Statfs(filepath.Dir(m.dir), &disk) == nil {
		out["disk_free"] = disk.Bavail * uint64(disk.Bsize)
		out["disk_total"] = disk.Blocks * uint64(disk.Bsize)
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

func (m *module) runNow(w http.ResponseWriter, r *http.Request) error {
	if err := m.requireDir(); err != nil {
		return err
	}
	if err := jobs.Enqueue(r.Context(), m.app.DB, jobKind, "run", nil, 0); err != nil {
		return err
	}
	w.WriteHeader(http.StatusAccepted)
	return nil
}

func (m *module) archivePath(r *http.Request) (string, error) {
	if err := m.requireDir(); err != nil {
		return "", err
	}
	name := r.PathValue("name")
	if !archiveName.MatchString(name) {
		return "", httpx.ErrNotFound
	}
	path := filepath.Join(m.dir, name)
	if _, err := os.Stat(path); err != nil {
		return "", httpx.ErrNotFound
	}
	return path, nil
}

// download needs a fresh password confirmation: an archive holds every account and sealed secret.
func (m *module) download(w http.ResponseWriter, r *http.Request) error {
	path, err := m.archivePath(r)
	if err != nil {
		return err
	}
	if err := m.requireReauth(r); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/x-tar")
	w.Header().Set("Content-Disposition", `attachment; filename="`+info.Name()+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

func (m *module) remove(w http.ResponseWriter, r *http.Request) error {
	path, err := m.archivePath(r)
	if err != nil {
		return err
	}
	if err := m.requireReauth(r); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	ctx := r.Context()
	p, _ := auth.From(ctx)
	err = pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		return events.PublishAs(ctx, tx, p.UserID, "platform", "backup.deleted", map[string]string{"id": filepath.Base(path)}, events.Audience{PlatformAdmins: true})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (m *module) saveSettings(w http.ResponseWriter, r *http.Request) error {
	var body settings
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if err := m.requireDir(); err != nil {
		return err
	}
	invalid := httpx.NewError(http.StatusBadRequest, "Failed to validate.")
	if body.Keep < 0 || body.Keep > 365 {
		invalid.Field("keep", "validation_out_of_range", "Must be between 0 and 365.")
	}
	if body.Hour < 0 || body.Hour > 23 {
		invalid.Field("hour", "validation_out_of_range", "Must be between 0 and 23.")
	}
	if len(invalid.Data) > 0 {
		return invalid
	}
	if err := m.requireReauth(r); err != nil {
		return err
	}
	ctx := r.Context()
	p, _ := auth.From(ctx)
	err := pgx.BeginFunc(ctx, m.app.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE backup_settings SET keep = $1, include_storage = $2, hour = $3, updated = now()`, body.Keep, body.IncludeStorage, body.Hour); err != nil {
			return err
		}
		return events.PublishAs(ctx, tx, p.UserID, "platform", "backup.updated", map[string]any{"id": "settings", "changed": []string{"keep", "include_storage", "hour"}}, events.Audience{PlatformAdmins: true})
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, body)
	return nil
}
