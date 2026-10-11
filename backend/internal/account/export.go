package account

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"strconv"
	"time"
)

type exportFile struct {
	name  string
	query string
}

// exportQueries name every table linked to the user; TestExportCoversEveryUserLink keeps this list complete.
var exportQueries = []exportFile{
	{"profile.json", `SELECT jsonb_build_object(
		'user', to_jsonb(u) - 'password_hash' - 'token_key',
		'followed_walls', COALESCE((SELECT jsonb_agg(jsonb_build_object('wall', w.name, 'location', l.name, 'gym', g.name) ORDER BY w.name)
			FROM walls w JOIN locations l ON l.id = w.location JOIN gyms g ON g.id = w.gym WHERE w.id = ANY (u.followed_walls)), '[]'))
		FROM users u WHERE u.id = $1`},
	{"ticks.json", `SELECT to_jsonb(t) FROM ticks t WHERE "user" = $1 ORDER BY date`},
	{"memberships.json", `SELECT jsonb_build_object('gym', g.name, 'gym_slug', g.slug, 'role', r.name, 'permissions', r.permissions, 'since', m.created)
		FROM memberships m JOIN gyms g ON g.id = m.gym JOIN roles r ON r.id = m.role WHERE m."user" = $1 ORDER BY m.created`},
	{"competition_entries.json", `SELECT to_jsonb(e) - 'user' || jsonb_build_object('competition', c.name, 'competition_starts_at', c.starts_at, 'category', cat.name)
		FROM competition_entries e JOIN competitions c ON c.id = e.competition LEFT JOIN competition_categories cat ON cat.id = e.category
		WHERE e."user" = $1 ORDER BY e.created`},
	{"devices.json", `SELECT jsonb_build_object('device', device, 'created', created) FROM push_subscriptions WHERE "user" = $1 ORDER BY created`},
	{"sessions.json", `SELECT to_jsonb(s) - 'user' FROM sessions s WHERE "user" = $1 ORDER BY created`},
	{"two_factor.json", `SELECT jsonb_build_object('id', id, 'kind', kind, 'name', name, 'created', created, 'last_used', last_used) FROM mfa_factors WHERE "user" = $1 ORDER BY created`},
	{"notifications.json", `SELECT to_jsonb(n) FROM notifications n WHERE "user" = $1 ORDER BY created`},
	{"activity_log.json", `SELECT to_jsonb(a) FROM audit_logs a WHERE actor = $1 ORDER BY created`},
	{"tasks.json", `SELECT to_jsonb(t) - 'reporter' - 'assignee' - 'done_by' || jsonb_build_object('relation', rel.label,
			'gym', (SELECT name FROM gyms WHERE id = t.gym), 'location', (SELECT name FROM locations WHERE id = t.location),
			'wall', (SELECT name FROM walls WHERE id = t.wall), 'route', (SELECT name FROM routes WHERE id = t.route))
		FROM tasks t JOIN (VALUES ('reporter', 'reported'), ('assignee', 'assigned'), ('done_by', 'closed')) AS rel(field, label)
		  ON (rel.field = 'reporter' AND t.reporter = $1) OR (rel.field = 'assignee' AND t.assignee = $1) OR (rel.field = 'done_by' AND t.done_by = $1)
		ORDER BY t.created`},
	{"reports.json", `SELECT to_jsonb(r) - 'decided_by' FROM reports r JOIN users u ON u.id = $1
		WHERE u.verified AND u.email <> '' AND lower(r.notifier_email) = lower(u.email) ORDER BY r.created`},
	{"follows.json", `SELECT jsonb_build_object('relation', rel.label, 'climber', trim(o.firstname || ' ' || o.name), 'status', f.status, 'since', f.created)
		FROM follows f JOIN (VALUES ('following'), ('follower')) AS rel(label)
		  ON (rel.label = 'following' AND f.follower = $1) OR (rel.label = 'follower' AND f.followee = $1)
		JOIN users o ON o.id = CASE WHEN rel.label = 'following' THEN f.followee ELSE f.follower END ORDER BY f.created`},
	{"beta_videos.json", `SELECT to_jsonb(b) - 'user' || jsonb_build_object('route', rt.name, 'gym', g.name)
		FROM beta_videos b LEFT JOIN routes rt ON rt.id = b.route LEFT JOIN gyms g ON g.id = b.gym WHERE b."user" = $1 ORDER BY b.created`},
	{"achievements.json", `SELECT to_jsonb(b) FROM user_badges b WHERE "user" = $1 ORDER BY created`},
	{"reviews.json", `SELECT to_jsonb(x) - 'user' || jsonb_build_object('route', rt.name, 'gym', g.name)
		FROM ratings x LEFT JOIN routes rt ON rt.id = x.route_id LEFT JOIN gyms g ON g.id = x.gym WHERE x."user" = $1 ORDER BY x.created`},
	{"blocked_climbers.json", `SELECT jsonb_build_object('climber', trim(o.firstname || ' ' || o.name), 'since', b.created)
		FROM blocks b JOIN users o ON o.id = b.blocked WHERE b.blocker = $1 ORDER BY b.created`},
	{"moderation.json", `SELECT to_jsonb(i) - 'author' - 'reviewed_by' FROM moderation_items i WHERE author = $1 ORDER BY created`},
}

const exportFilesQuery = `
	SELECT 'users/' || id || '/' || avatar, 'avatar' || COALESCE(substring(avatar FROM '\.[^.]*$'), '') FROM users WHERE id = $1 AND avatar <> ''
	UNION ALL SELECT 'users/' || id || '/' || banner, 'banner' || COALESCE(substring(banner FROM '\.[^.]*$'), '') FROM users WHERE id = $1 AND banner <> ''
	UNION ALL SELECT 'tasks/' || id || '/' || photo, 'task_photos/' || id || '_' || photo FROM tasks WHERE reporter = $1 AND photo <> ''
	UNION ALL SELECT 'beta_videos/' || id || '/' || file, 'beta_videos/' || id || '_' || file FROM beta_videos WHERE "user" = $1 AND file <> ''
	UNION ALL SELECT 'moderation_items/' || id || '/' || f, 'moderation/' || id || '_' || f FROM moderation_items, unnest(files) AS f WHERE author = $1`

// exportMaxBytes caps one archive; larger exports answer 413 before anything is sent.
var exportMaxBytes int64 = 2 << 30

var errExportTooLarge = errors.New("account: export exceeds exportMaxBytes")

// exportPart is a generated file (data) or a stored blob (key) of the archive.
type exportPart struct {
	name string
	data []byte
	key  string
}

// collectExport runs every query up front, so a failure answers 500 instead of a partial archive, and sums the archive size.
func (m *module) collectExport(ctx context.Context, userID string) ([]exportPart, int64, error) {
	var parts []exportPart
	var total int64
	for _, file := range exportQueries {
		query := `SELECT COALESCE(jsonb_agg(q.j), '[]') FROM (` + file.query + `) q(j)`
		if file.name == "profile.json" {
			query = file.query
		}
		var data json.RawMessage
		if err := m.db.QueryRow(ctx, query, userID).Scan(&data); err != nil {
			return nil, 0, err
		}
		var pretty bytes.Buffer
		if err := json.Indent(&pretty, data, "", "  "); err != nil {
			return nil, 0, err
		}
		pretty.WriteByte('\n')
		parts = append(parts, exportPart{name: file.name, data: pretty.Bytes()})
		total += int64(pretty.Len())
	}
	var logbook bytes.Buffer
	if err := m.writeLogbook(ctx, &logbook, userID); err != nil {
		return nil, 0, err
	}
	parts = append(parts, exportPart{name: "logbook.csv", data: logbook.Bytes()})
	total += int64(logbook.Len())
	rows, err := m.db.Query(ctx, exportFilesQuery, userID)
	if err != nil {
		return nil, 0, err
	}
	files := map[string]string{}
	for rows.Next() {
		var key, name string
		if err := rows.Scan(&key, &name); err != nil {
			return nil, 0, err
		}
		files[key] = name
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	for key, name := range files {
		size, err := m.blobSize(ctx, key)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, 0, err
		}
		parts = append(parts, exportPart{name: name, key: key})
		total += size
	}
	return parts, total, nil
}

func (m *module) blobSize(ctx context.Context, key string) (int64, error) {
	r, err := m.blob.Open(ctx, key)
	if err != nil {
		return 0, err
	}
	defer r.Close()
	if file, ok := r.(interface{ Stat() (fs.FileInfo, error) }); ok {
		info, err := file.Stat()
		if err != nil {
			return 0, err
		}
		return info.Size(), nil
	}
	return 0, nil
}

// streamExport writes the archive straight to w and stops once more than exportMaxBytes went out (files can grow after collectExport).
func (m *module) streamExport(ctx context.Context, w io.Writer, parts []exportPart) error {
	zw := zip.NewWriter(w)
	remaining := exportMaxBytes
	for _, part := range parts {
		n, err := m.writePart(ctx, zw, part, remaining+1)
		if err != nil {
			return err
		}
		if remaining -= n; remaining < 0 {
			return errExportTooLarge
		}
	}
	return zw.Close()
}

func (m *module) writePart(ctx context.Context, zw *zip.Writer, part exportPart, limit int64) (int64, error) {
	var src io.Reader = bytes.NewReader(part.data)
	header := &zip.FileHeader{Name: part.name, Method: zip.Deflate, Modified: time.Now()}
	if part.key != "" {
		r, err := m.blob.Open(ctx, part.key)
		if errors.Is(err, fs.ErrNotExist) {
			return 0, nil
		}
		if err != nil {
			return 0, err
		}
		defer r.Close()
		src, header.Method = r, zip.Store
	}
	out, err := zw.CreateHeader(header)
	if err != nil {
		return 0, err
	}
	return io.Copy(out, io.LimitReader(src, limit))
}

func (m *module) writeLogbook(ctx context.Context, w io.Writer, userID string) error {
	rows, err := m.db.Query(ctx, `SELECT t.date, COALESCE(NULLIF(t.route_name, ''), rt.name, ''), t.grade, t.grade_system, t.type, t.attempts, t.note, COALESCE(g.name, '')
		FROM ticks t LEFT JOIN routes rt ON rt.id = t.route LEFT JOIN gyms g ON g.id = rt.gym WHERE t."user" = $1 ORDER BY t.date`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := csv.NewWriter(w)
	out.Write([]string{"date", "route", "grade", "grade_system", "type", "attempts", "note", "gym"})
	for rows.Next() {
		var date time.Time
		var route, grade, system, kind, note, gym string
		var attempts int
		if err := rows.Scan(&date, &route, &grade, &system, &kind, &attempts, &note, &gym); err != nil {
			return err
		}
		out.Write([]string{date.Format(time.DateOnly), route, grade, system, kind, strconv.Itoa(attempts), note, gym})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	out.Flush()
	return out.Error()
}
