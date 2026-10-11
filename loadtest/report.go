package main

import (
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	groupSSR        = "ssr"
	groupStatic     = "static"
	groupAPI        = "api"
	groupThumb      = "thumbs"
	groupWrite      = "writes"
	groupSSEConnect = "sse-connect"
	groupSSEEvent   = "sse-event"
)

var groups = []string{groupSSR, groupStatic, groupAPI, groupThumb, groupWrite, groupSSEConnect, groupSSEEvent}

type series struct {
	durations []time.Duration
	failed    int
	limited   int
	statuses  map[int]int
}

// recorder keeps every sample after warm-up per request name and per group.
// ponytail: all durations stay in memory (8 bytes each, ~30 MB per hour at 1000 req/s); use a reservoir for multi-hour runs.
type recorder struct {
	mu     sync.Mutex
	from   time.Time
	names  map[string]*series
	groups map[string]*series
	labels map[string]string
	errors map[string]string
}

var stats = newRecorder()

func newRecorder() *recorder {
	return &recorder{names: map[string]*series{}, groups: map[string]*series{}, labels: map[string]string{}, errors: map[string]string{}}
}

func (r *recorder) add(group, name string, status int, d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if time.Now().Before(r.from) {
		return
	}
	key := group + " " + name
	r.labels[key] = group
	for _, s := range []*series{r.series(r.names, key), r.series(r.groups, group)} {
		s.statuses[status]++
		switch {
		case status == 429:
			s.limited++
			s.failed++
		case status == 0 || status >= 400:
			s.failed++
		default:
			s.durations = append(s.durations, d)
		}
	}
}

// sample keeps the first failing response per request name and status, so a report shows why, not just how often.
func (r *recorder) sample(key string, status int, request string, body []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key = fmt.Sprintf("%s %d", key, status)
	if _, seen := r.errors[key]; !seen {
		r.errors[key] = fmt.Sprintf("%s → %.200s", request, strings.TrimSpace(string(body)))
	}
}

func (r *recorder) series(m map[string]*series, key string) *series {
	s := m[key]
	if s == nil {
		s = &series{statuses: map[int]int{}}
		m[key] = s
	}
	return s
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	i := int(p/100*float64(len(sorted))+0.999999) - 1
	return sorted[min(max(i, 0), len(sorted)-1)]
}

type row struct {
	name                   string
	count, failed, limited int
	p50, p95, p99, maxDur  time.Duration
}

func (s *series) row(name string) row {
	sorted := slices.Clone(s.durations)
	slices.Sort(sorted)
	r := row{name: name, count: len(sorted) + s.failed, failed: s.failed, limited: s.limited,
		p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99)}
	if len(sorted) > 0 {
		r.maxDur = sorted[len(sorted)-1]
	}
	return r
}

func (r row) errorRate() float64 { return float64(r.failed) / float64(max(r.count, 1)) }

// slo is one threshold: "<group>.p95<800ms" or "<group>.errors<1%"; group "all" covers every request.
type slo struct {
	group, metric string
	limit         float64
}

func parseSLOs(spec string) ([]slo, error) {
	var out []slo
	for part := range strings.SplitSeq(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		target, limit, ok := strings.Cut(part, "<")
		group, metric, ok2 := strings.Cut(target, ".")
		if !ok || !ok2 || (group != "all" && !slices.Contains(groups, group)) {
			return nil, fmt.Errorf("slo %q: want <group>.<p50|p95|p99|errors><limit>, groups: all, %s", part, strings.Join(groups, ", "))
		}
		var value float64
		switch metric {
		case "errors":
			v, err := strconv.ParseFloat(strings.TrimSuffix(limit, "%"), 64)
			if err != nil {
				return nil, fmt.Errorf("slo %q: %w", part, err)
			}
			value = v / 100
		case "p50", "p95", "p99":
			d, err := time.ParseDuration(limit)
			if err != nil {
				return nil, fmt.Errorf("slo %q: %w", part, err)
			}
			value = float64(d)
		default:
			return nil, fmt.Errorf("slo %q: unknown metric %s", part, metric)
		}
		out = append(out, slo{group, metric, value})
	}
	return out, nil
}

func (s slo) check(r row) (string, bool) {
	var actual float64
	var shown string
	switch s.metric {
	case "errors":
		actual, shown = r.errorRate(), fmt.Sprintf("%.2f%% (limit %.2f%%)", r.errorRate()*100, s.limit*100)
	default:
		d := map[string]time.Duration{"p50": r.p50, "p95": r.p95, "p99": r.p99}[s.metric]
		actual, shown = float64(d), fmt.Sprintf("%s (limit %s)", d.Round(time.Millisecond), time.Duration(s.limit))
	}
	return shown, r.count == 0 || actual < s.limit
}

// report prints groups, endpoints and SLO results and tells whether every SLO held.
func (r *recorder) report(w io.Writer, elapsed time.Duration, slos []slo) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	header := fmt.Sprintf("%-58s %8s %7s %7s %8s %8s %8s %8s\n", "", "count", "rps", "err%", "p50", "p95", "p99", "max")
	line := func(x row) {
		fmt.Fprintf(w, "%-58s %8d %7.1f %7.2f %8s %8s %8s %8s\n", x.name, x.count, float64(x.count)/elapsed.Seconds(), x.errorRate()*100,
			x.p50.Round(time.Millisecond), x.p95.Round(time.Millisecond), x.p99.Round(time.Millisecond), x.maxDur.Round(time.Millisecond))
	}
	fmt.Fprint(w, "\nby group"+header[8:])
	all := &series{statuses: map[int]int{}}
	for _, g := range groups {
		if s := r.groups[g]; s != nil {
			line(s.row(g))
			if g != groupSSEEvent {
				all.durations = append(all.durations, s.durations...)
				all.failed += s.failed
				all.limited += s.limited
			}
		}
	}
	line(all.row("all requests"))
	fmt.Fprint(w, "\nby request"+header[10:])
	keys := slices.Sorted(maps.Keys(r.names))
	slices.SortStableFunc(keys, func(a, b string) int {
		return slices.Index(groups, r.labels[a]) - slices.Index(groups, r.labels[b])
	})
	for _, key := range keys {
		line(r.names[key].row(key))
		if s := r.names[key]; s.failed > 0 {
			var codes []string
			for _, code := range slices.Sorted(maps.Keys(s.statuses)) {
				if code == 0 || code >= 400 {
					codes = append(codes, fmt.Sprintf("%d×%d", code, s.statuses[code]))
				}
			}
			fmt.Fprintf(w, "    failed: %s\n", strings.Join(codes, " "))
			for _, code := range slices.Sorted(maps.Keys(s.statuses)) {
				if example, ok := r.errors[fmt.Sprintf("%s %d", key, code)]; ok {
					fmt.Fprintf(w, "    e.g. %s\n", example)
				}
			}
		}
	}
	if all.limited > 0 {
		fmt.Fprintf(w, "\n%d responses were 429: the target rate-limits this generator's IP (run it with RATE_LIMITS=off)\n", all.limited)
	}
	pass := true
	fmt.Fprintln(w, "\nSLOs")
	for _, s := range slos {
		x := all.row("all")
		if s.group != "all" {
			g := r.groups[s.group]
			if g == nil {
				g = &series{statuses: map[int]int{}}
			}
			x = g.row(s.group)
		}
		shown, ok := s.check(x)
		verdict := "PASS"
		if !ok {
			verdict, pass = "FAIL", false
		}
		fmt.Fprintf(w, "  %s  %s.%s %s\n", verdict, s.group, s.metric, shown)
	}
	return pass
}
