package platformadmin

import (
	"context"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"gripello/internal/platform/config"
	"gripello/internal/platform/httpx"
	"gripello/internal/platform/metrics"
	"gripello/internal/platform/replicas"
)

type trafficRange struct {
	span, step time.Duration
}

var trafficRanges = map[string]trafficRange{
	"1h":  {time.Hour, metrics.Bucket},
	"24h": {24 * time.Hour, time.Hour},
	"7d":  {7 * 24 * time.Hour, 6 * time.Hour},
	"30d": {30 * 24 * time.Hour, 24 * time.Hour},
}

type latency [11]int64

// p95 answers the upper bound of the histogram column holding the 95th percentile (0 without samples).
func (l latency) p95() float64 {
	var total int64
	for _, n := range l {
		total += n
	}
	if total == 0 {
		return 0
	}
	threshold := int64(math.Ceil(float64(total) * 0.95))
	var seen int64
	for i, n := range l {
		if seen += n; seen >= threshold {
			if i < len(metrics.LatencyBounds) {
				return metrics.LatencyBounds[i]
			}
			break
		}
	}
	return metrics.LatencyBounds[len(metrics.LatencyBounds)-1] * 2
}

func (l latency) samples() (n int64) {
	for _, v := range l {
		n += v
	}
	return n
}

const (
	histogramSums          = `sum(b0), sum(b1), sum(b2), sum(b3), sum(b4), sum(b5), sum(b6), sum(b7), sum(b8), sum(b9), sum(b10)`
	coalescedHistogramSums = `COALESCE(sum(b0), 0), COALESCE(sum(b1), 0), COALESCE(sum(b2), 0), COALESCE(sum(b3), 0), COALESCE(sum(b4), 0), COALESCE(sum(b5), 0),
		COALESCE(sum(b6), 0), COALESCE(sum(b7), 0), COALESCE(sum(b8), 0), COALESCE(sum(b9), 0), COALESCE(sum(b10), 0)`
)

func histogramTargets(l *latency) []any {
	out := make([]any, len(l))
	for i := range l {
		out[i] = &l[i]
	}
	return out
}

type trafficTotals struct {
	Requests     int64   `json:"requests"`
	ClientErrors int64   `json:"client_errors"`
	ServerErrors int64   `json:"server_errors"`
	P95          float64 `json:"p95_ms"`
}

func (m *module) trafficTotals(ctx context.Context, from, to time.Time) (trafficTotals, error) {
	var t trafficTotals
	var l latency
	targets := append([]any{&t.Requests, &t.ClientErrors, &t.ServerErrors}, histogramTargets(&l)...)
	err := m.app.DB.QueryRow(ctx, `SELECT COALESCE(sum(total), 0), COALESCE(sum(client_errors), 0), COALESCE(sum(server_errors), 0),
		`+coalescedHistogramSums+` FROM request_stats WHERE bucket >= $1 AND bucket < $2`, from, to).Scan(targets...)
	t.P95 = l.p95()
	return t, err
}

// traffic feeds the overview: request series, totals with the previous window, endpoints, people and system state.
func (m *module) traffic(w http.ResponseWriter, r *http.Request) error {
	rangeName := r.URL.Query().Get("range")
	tr, ok := trafficRanges[rangeName]
	if !ok {
		rangeName, tr = "24h", trafficRanges["24h"]
	}
	ctx := r.Context()
	now := time.Now().UTC()
	end := now.Truncate(tr.step).Add(tr.step)
	since := end.Add(-tr.span)

	type point struct {
		Time         time.Time `json:"t"`
		Requests     int64     `json:"requests"`
		ClientErrors int64     `json:"client_errors"`
		ServerErrors int64     `json:"server_errors"`
	}
	series := []point{}
	byTime := map[int64]int{}
	for t := since; t.Before(end); t = t.Add(tr.step) {
		byTime[t.Unix()] = len(series)
		series = append(series, point{Time: t})
	}
	rows, err := m.app.DB.Query(ctx, `SELECT date_bin($1::interval, bucket, $2::timestamptz) AS t, sum(total), sum(client_errors), sum(server_errors)
		FROM request_stats WHERE bucket >= $2 GROUP BY t`, tr.step, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var p point
		if err := rows.Scan(&p.Time, &p.Requests, &p.ClientErrors, &p.ServerErrors); err != nil {
			rows.Close()
			return err
		}
		if i, ok := byTime[p.Time.Unix()]; ok {
			series[i] = point{Time: series[i].Time, Requests: p.Requests, ClientErrors: p.ClientErrors, ServerErrors: p.ServerErrors}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	current, err := m.trafficTotals(ctx, since, end)
	if err != nil {
		return err
	}
	previous, err := m.trafficTotals(ctx, since.Add(-tr.span), since)
	if err != nil {
		return err
	}
	var peak int64
	if err := m.app.DB.QueryRow(ctx, `SELECT COALESCE(max(n), 0) FROM (SELECT sum(total) AS n FROM request_stats WHERE bucket >= $1 GROUP BY bucket) b`, since).Scan(&peak); err != nil {
		return err
	}

	type endpoint struct {
		Method       string  `json:"method"`
		Pattern      string  `json:"pattern"`
		Requests     int64   `json:"requests"`
		ClientErrors int64   `json:"client_errors"`
		ServerErrors int64   `json:"server_errors"`
		AvgMS        float64 `json:"avg_ms"`
		P95          float64 `json:"p95_ms"`
	}
	endpoints := []endpoint{}
	rows, err = m.app.DB.Query(ctx, `SELECT method, pattern, sum(total), sum(client_errors), sum(server_errors), sum(duration_ms), `+histogramSums+`
		FROM request_stats WHERE bucket >= $1 GROUP BY method, pattern ORDER BY sum(total) DESC LIMIT 100`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var e endpoint
		var duration float64
		var l latency
		if err := rows.Scan(append([]any{&e.Method, &e.Pattern, &e.Requests, &e.ClientErrors, &e.ServerErrors, &duration}, histogramTargets(&l)...)...); err != nil {
			rows.Close()
			return err
		}
		if n := l.samples(); n > 0 {
			e.AvgMS = math.Round(duration/float64(n)*10) / 10
			e.P95 = l.p95()
		}
		endpoints = append(endpoints, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	visitorDays := max(int(tr.span.Hours()/24), 1)
	var visitors int
	if err := m.app.DB.QueryRow(ctx, `SELECT count(*) / $2::int FROM request_visitors WHERE day > ($1::timestamptz)::date - $2::int`, now, visitorDays).Scan(&visitors); err != nil {
		return err
	}

	system, err := m.systemState(ctx)
	if err != nil {
		return err
	}
	online := 0
	for _, server := range system["replicas"].([]replicas.Replica) {
		if server.Online {
			online += server.RealtimeClients
		}
	}
	people := map[string]any{"online": online}
	var signedIn, newAccounts, failed int
	if err := m.app.DB.QueryRow(ctx, `SELECT
		(SELECT count(DISTINCT "user") FROM sessions WHERE COALESCE(last_seen, updated) >= $1),
		(SELECT count(*) FROM users WHERE created >= $1),
		(SELECT count(*) FROM audit_logs WHERE action = 'login_failed' AND created >= $1)`, since).Scan(&signedIn, &newAccounts, &failed); err != nil {
		return err
	}
	people["signed_in"], people["new_accounts"], people["failed_logins"] = signedIn, newAccounts, failed
	methods := map[string]int{}
	rows, err = m.app.DB.Query(ctx, `SELECT method, count(*) FROM sessions WHERE created >= $1 AND method <> '' GROUP BY method`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var method string
		var n int
		if err := rows.Scan(&method, &n); err != nil {
			rows.Close()
			return err
		}
		methods[method] = n
	}
	rows.Close()
	people["sign_in_methods"] = methods

	httpx.JSON(w, http.StatusOK, map[string]any{
		"range": rangeName, "step_seconds": int(tr.step.Seconds()), "series": series,
		"totals": current, "previous": previous, "peak_rps": math.Round(float64(peak)/metrics.Bucket.Seconds()*10) / 10,
		"visitors_per_day": visitors, "endpoints": endpoints, "people": people, "system": system,
	})
	return nil
}

func (m *module) systemState(ctx context.Context) (map[string]any, error) {
	var dbSize int64
	var connections, jobsWaiting, jobsRunning int
	var lastBackup *time.Time
	var backupError string
	err := m.app.DB.QueryRow(ctx, `SELECT pg_database_size(current_database()),
		(SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
		(SELECT count(*) FILTER (WHERE locked_until IS NULL OR locked_until < now()) FROM jobs),
		(SELECT count(*) FILTER (WHERE locked_until >= now()) FROM jobs)`).Scan(&dbSize, &connections, &jobsWaiting, &jobsRunning)
	if err != nil {
		return nil, err
	}
	if err := m.app.DB.QueryRow(ctx, `SELECT last_run, last_error FROM backup_settings`).Scan(&lastBackup, &backupError); err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	servers, err := replicas.List(ctx, m.app.DB)
	if err != nil {
		return nil, err
	}
	state := map[string]any{
		"version": config.Version, "replicas": servers, "database_bytes": dbSize, "database_connections": connections,
		"jobs_waiting": jobsWaiting, "jobs_running": jobsRunning, "last_backup": lastBackup, "backup_error": backupError,
	}
	if c, ok := m.app.Mail.(interface{ Configured() bool }); ok {
		state["mail_configured"] = c.Configured()
	}
	return state, nil
}
