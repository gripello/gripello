package main

import (
	"bytes"
	"math"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestArrivalsFollowTheProfile(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	evening, _ := parseProfile("evening")
	at := arrivals(evening, 10, time.Hour, rng)
	// The evening curve averages 0.635 of the peak: about 10/s * 3600 s * 0.635 sessions.
	if want := 22860.0; math.Abs(float64(len(at))-want) > want*0.03 {
		t.Fatalf("got %d arrivals, want about %.0f", len(at), want)
	}
	if !slices.IsSorted(at) || at[len(at)-1] >= time.Hour {
		t.Fatal("arrivals must be ordered and inside the run")
	}
	quiet, peak := 0, 0
	for _, d := range at {
		switch {
		case d < 6*time.Minute:
			quiet++
		case d >= 36*time.Minute && d < 42*time.Minute:
			peak++
		}
	}
	if ratio := float64(peak) / float64(quiet); ratio < 3 || ratio > 4.5 {
		t.Fatalf("peak/quiet ratio %.2f, want about 3.7", ratio)
	}
}

func TestArrivalsWithoutLoad(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	if at := arrivals(profile{{0, 0}, {1, 0}}, 10, time.Minute, rng); len(at) != 0 {
		t.Fatalf("got %d arrivals from a zero profile", len(at))
	}
	ramp, _ := parseProfile("ramp")
	at := arrivals(ramp, 50, time.Minute, rng)
	firstHalf := 0
	for _, d := range at {
		if d < 30*time.Second {
			firstHalf++
		}
	}
	if share := float64(firstHalf) / float64(len(at)); share < 0.2 || share > 0.3 {
		t.Fatalf("a linear ramp puts a quarter of the arrivals in the first half, got %.2f", share)
	}
}

func TestParseProfile(t *testing.T) {
	p, err := parseProfile("0:0.2, 0.5:1, 1:0.4")
	if err != nil {
		t.Fatal(err)
	}
	for progress, want := range map[float64]float64{0: 0.2, 0.25: 0.6, 0.5: 1, 0.75: 0.7, 1: 0.4} {
		if got := p.level(progress); math.Abs(got-want) > 1e-9 {
			t.Errorf("level(%v) = %v, want %v", progress, got, want)
		}
	}
	for _, bad := range []string{"night", "0:1,0.5", "0.1:1,1:1", "0:1,0.5:1,0.4:1", "0:1,1:-1"} {
		if _, err := parseProfile(bad); err == nil {
			t.Errorf("parseProfile(%q) accepted", bad)
		}
	}
}

func TestThinkTimeIsLogNormal(t *testing.T) {
	rng := rand.New(rand.NewPCG(3, 4))
	median := 10 * time.Second
	var samples []time.Duration
	for range 20000 {
		samples = append(samples, thinkTime(median, rng))
	}
	slices.Sort(samples)
	if got := samples[len(samples)/2]; got < 9*time.Second || got > 11*time.Second {
		t.Fatalf("median %s, want about 10s", got)
	}
	if samples[0] < median/8 || samples[len(samples)-1] > median*8 {
		t.Fatal("think times must stay within median/8..median*8")
	}
	// Right-skewed: the mean sits above the median.
	var sum time.Duration
	for _, s := range samples {
		sum += s
	}
	if mean := sum / time.Duration(len(samples)); mean < 12*time.Second {
		t.Fatalf("mean %s, want the long tail to lift it above 12s", mean)
	}
}

func TestPickWeighted(t *testing.T) {
	mix, err := parseMix("guest=3,qr=1,climber=0", personas)
	if err != nil {
		t.Fatal(err)
	}
	rng := rand.New(rand.NewPCG(5, 6))
	counts := map[string]int{}
	for range 40000 {
		counts[pickWeighted(mix, rng)]++
	}
	if counts["climber"] != 0 {
		t.Fatal("a zero weight was picked")
	}
	if share := float64(counts["guest"]) / 40000; math.Abs(share-0.75) > 0.01 {
		t.Fatalf("guest share %.3f, want 0.75", share)
	}
	if _, err := parseMix("guests=1", personas); err == nil {
		t.Fatal("an unknown persona was accepted")
	}
}

func TestReportChecksSLOs(t *testing.T) {
	r := newRecorder()
	for i := range 100 {
		r.add(groupAPI, "GET /routes/{id}", 200, time.Duration(i+1)*time.Millisecond)
	}
	r.add(groupAPI, "GET /routes/{id}", 500, time.Millisecond)
	r.add(groupSSR, "GET /{gym}", 429, time.Millisecond)
	r.add(groupSSR, "GET /{gym}", 200, 900*time.Millisecond)

	slos, err := parseSLOs("api.p95<96ms,api.p99<99ms,ssr.p50<1s,all.errors<1%,thumbs.p95<1ms")
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if r.report(&out, time.Minute, slos) {
		t.Fatal("the report passed although p99 and the error rate break their SLOs")
	}
	text := out.String()
	for _, want := range []string{
		"PASS  api.p95 95ms", "FAIL  api.p99 99ms", "PASS  ssr.p50", "FAIL  all.errors 1.94%", "PASS  thumbs.p95 0s",
		"failed: 500×1", "failed: 429×1", "rate-limits this generator",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("report misses %q:\n%s", want, text)
		}
	}
	if _, err := parseSLOs("api.p90<1s"); err == nil {
		t.Error("an unknown metric was accepted")
	}
	if _, err := parseSLOs("db.p95<1s"); err == nil {
		t.Error("an unknown group was accepted")
	}
}

func TestPercentile(t *testing.T) {
	var sorted []time.Duration
	for i := 1; i <= 10; i++ {
		sorted = append(sorted, time.Duration(i))
	}
	for p, want := range map[float64]time.Duration{50: 5, 95: 10, 99: 10, 10: 1} {
		if got := percentile(sorted, p); got != want {
			t.Errorf("p%v = %d, want %d", p, got, want)
		}
	}
	if percentile(nil, 95) != 0 {
		t.Error("an empty series has no percentile")
	}
}
