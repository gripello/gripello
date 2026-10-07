package main

import (
	"fmt"
	"maps"
	"math"
	mrand "math/rand/v2"
	"slices"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

var (
	total        = newStats()
	window       atomic.Pointer[stats]
	eventLatency = newStats()
)

var trafficByLabel sync.Map

func init() {
	window.Store(newStats())
}

func countTraffic(label string, up, down int64) {
	counters, _ := trafficByLabel.LoadOrStore(label, &[2]atomic.Int64{})
	counters.(*[2]atomic.Int64)[0].Add(up)
	counters.(*[2]atomic.Int64)[1].Add(down)
}

func trafficTotals() (up, down int64) {
	trafficByLabel.Range(func(_, counters any) bool {
		up += counters.(*[2]atomic.Int64)[0].Load()
		down += counters.(*[2]atomic.Int64)[1].Load()
		return true
	})
	return up, down
}

func printTraffic(elapsed time.Duration) {
	type row struct {
		label    string
		up, down int64
	}
	rows := []row{}
	trafficByLabel.Range(func(label, counters any) bool {
		c := counters.(*[2]atomic.Int64)
		rows = append(rows, row{label.(string), c[0].Load(), c[1].Load()})
		return true
	})
	sort.Slice(rows, func(i, j int) bool { return rows[i].down+rows[i].up > rows[j].down+rows[j].up })
	up, down := trafficTotals()
	mbit := func(bytes int64) float64 { return float64(bytes) * 8 / elapsed.Seconds() / 1e6 }
	fmt.Printf("%-28s %12s %12s %10s %10s\n", "traffic (client view)", "up MB", "down MB", "up Mbit/s", "down Mbit/s")
	for _, r := range rows {
		fmt.Printf("%-28s %12.1f %12.1f %10.2f %10.2f\n", r.label, float64(r.up)/1e6, float64(r.down)/1e6, mbit(r.up), mbit(r.down))
	}
	fmt.Printf("%-28s %12.1f %12.1f %10.2f %10.2f\n", "TOTAL", float64(up)/1e6, float64(down)/1e6, mbit(up), mbit(down))
}

func record(label string, d time.Duration, failed string) {
	total.add(label, d, failed)
	window.Load().add(label, d, failed)
}

func recordEvent(label string, d time.Duration) {
	eventLatency.add(label, d, "")
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	return sorted[int(math.Min(float64(len(sorted)-1), math.Ceil(p*float64(len(sorted)))-1))]
}

func printEventVolume(elapsed time.Duration) {
	fmt.Printf("%-28s %12s %10s\n", "realtime topic", "events", "per s")
	eventsByTopic.Range(func(topic, counter any) bool {
		count := counter.(*atomic.Int64).Load()
		fmt.Printf("%-28s %12d %10.0f\n", topic, count, float64(count)/elapsed.Seconds())
		return true
	})
}

const reservoirSize = 20_000

// stats keeps exact counts and maxima but only a uniform sample of latencies per label, so memory stays bounded.
type stats struct {
	mu        sync.Mutex
	latencies map[string][]time.Duration
	counts    map[string]int
	maxima    map[string]time.Duration
	errors    map[string]int
}

func newStats() *stats {
	return &stats{latencies: map[string][]time.Duration{}, counts: map[string]int{}, maxima: map[string]time.Duration{}, errors: map[string]int{}}
}

func (s *stats) add(label string, d time.Duration, failed string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if failed != "" {
		s.errors[label+" "+failed]++
		return
	}
	s.counts[label]++
	s.maxima[label] = max(s.maxima[label], d)
	if samples := s.latencies[label]; len(samples) < reservoirSize {
		s.latencies[label] = append(samples, d)
	} else if j := mrand.IntN(s.counts[label]); j < reservoirSize {
		samples[j] = d
	}
}

type labelStats struct {
	label   string
	count   int
	max     time.Duration
	samples []time.Duration
}

// snapshot copies the samples so sorting happens outside the lock.
func (s *stats) snapshot() ([]labelStats, map[string]int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	labels := make([]labelStats, 0, len(s.latencies))
	for label, samples := range s.latencies {
		sorted := slices.Clone(samples)
		slices.Sort(sorted)
		labels = append(labels, labelStats{label, s.counts[label], s.maxima[label], sorted})
	}
	errors := maps.Clone(s.errors)
	sort.Slice(labels, func(i, j int) bool { return labels[i].label < labels[j].label })
	return labels, errors
}

type summary struct {
	requests, errors int
	p95              time.Duration
	slowest          []string
}

func (s *stats) summarize() summary {
	labels, errors := s.snapshot()
	var out summary
	type weighted struct {
		d      time.Duration
		weight float64
	}
	all := []weighted{}
	total := 0.0
	for _, l := range labels {
		out.requests += l.count
		weight := float64(l.count) / float64(len(l.samples))
		for _, d := range l.samples {
			all = append(all, weighted{d, weight})
		}
		total += float64(l.count)
	}
	for _, count := range errors {
		out.errors += count
	}
	slices.SortFunc(all, func(a, b weighted) int { return int(a.d - b.d) })
	seen := 0.0
	for _, w := range all {
		if seen += w.weight; seen >= total*.95 {
			out.p95 = w.d
			break
		}
	}
	sort.Slice(labels, func(i, j int) bool { return percentile(labels[i].samples, .95) > percentile(labels[j].samples, .95) })
	for _, l := range labels[:min(4, len(labels))] {
		out.slowest = append(out.slowest, fmt.Sprintf("%s=%s", l.label, percentile(l.samples, .95).Round(time.Millisecond)))
	}
	return out
}

func (s *stats) print(elapsed time.Duration) {
	labels, errors := s.snapshot()
	fmt.Printf("%-28s %9s %8s %8s %8s %8s %8s\n", "label", "count", "rps", "p50", "p95", "p99", "max")
	for _, l := range labels {
		fmt.Printf("%-28s %9d %8.1f %8s %8s %8s %8s\n", l.label, l.count, float64(l.count)/elapsed.Seconds(),
			percentile(l.samples, .5).Round(time.Millisecond), percentile(l.samples, .95).Round(time.Millisecond),
			percentile(l.samples, .99).Round(time.Millisecond), l.max.Round(time.Millisecond))
	}
	keys := slices.Sorted(maps.Keys(errors))
	for _, key := range keys {
		fmt.Printf("ERROR %-44s %d\n", key, errors[key])
	}
}
