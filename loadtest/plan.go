package main

import (
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
	"time"
)

// profile is a piecewise-linear load curve: points of (share of the test elapsed, share of the peak arrival rate).
type profile [][2]float64

var profiles = map[string]profile{
	"flat": {{0, 1}, {1, 1}},
	// A weekday in a gym squeezed into the test: quiet afternoon, after-work peak, late tail.
	"evening": {{0, 0.25}, {0.3, 0.4}, {0.55, 1}, {0.75, 1}, {1, 0.3}},
	// Competition night: steady gym traffic, then spectators flood in for the final.
	"comp": {{0, 0.3}, {0.4, 0.35}, {0.5, 1}, {0.8, 1}, {1, 0.2}},
	"ramp": {{0, 0}, {1, 1}},
}

// parseProfile takes a preset name or "x:y,x:y" points with x rising from 0 to 1.
func parseProfile(spec string) (profile, error) {
	if p, ok := profiles[spec]; ok {
		return p, nil
	}
	var p profile
	for part := range strings.SplitSeq(spec, ",") {
		x, y, ok := strings.Cut(part, ":")
		at, err1 := strconv.ParseFloat(strings.TrimSpace(x), 64)
		level, err2 := strconv.ParseFloat(strings.TrimSpace(y), 64)
		if !ok || err1 != nil || err2 != nil || at < 0 || at > 1 || level < 0 || (len(p) > 0 && at <= p[len(p)-1][0]) {
			return nil, fmt.Errorf("profile %q: want a preset (flat, evening, comp, ramp) or rising x:y points like 0:0.2,0.5:1,1:0.3", spec)
		}
		p = append(p, [2]float64{at, level})
	}
	if p[0][0] != 0 || p[len(p)-1][0] != 1 {
		return nil, fmt.Errorf("profile %q must start at 0 and end at 1", spec)
	}
	return p, nil
}

func (p profile) level(progress float64) float64 {
	for i := 1; i < len(p); i++ {
		if progress <= p[i][0] {
			a, b := p[i-1], p[i]
			return a[1] + (b[1]-a[1])*(progress-a[0])/(b[0]-a[0])
		}
	}
	return p[len(p)-1][1]
}

// arrivals is an open model: a Poisson process whose rate follows the profile, independent of how fast the server answers.
func arrivals(p profile, peakPerSecond float64, duration time.Duration, rng *rand.Rand) []time.Duration {
	var at []time.Duration
	// Thinning: draw at the peak rate and keep each arrival with probability level/maxLevel.
	maxLevel := 0.0
	for _, point := range p {
		maxLevel = max(maxLevel, point[1])
	}
	if maxLevel == 0 || peakPerSecond <= 0 {
		return nil
	}
	rate := peakPerSecond * maxLevel
	for t := 0.0; ; {
		t += rng.ExpFloat64() / rate
		if t >= duration.Seconds() {
			return at
		}
		if rng.Float64()*maxLevel < p.level(t/duration.Seconds()) {
			at = append(at, time.Duration(t*float64(time.Second)))
		}
	}
}

// thinkTime is log-normal around median: most pauses are short, a few people stare at their phone for a long time.
func thinkTime(median time.Duration, rng *rand.Rand) time.Duration {
	const sigma = 0.8
	d := time.Duration(float64(median) * math.Exp(sigma*rng.NormFloat64()))
	return min(max(d, median/8), median*8)
}

type weight struct {
	name   string
	weight float64
}

// parseMix reads "guest=30,qr=25" into weights; unknown names are rejected so typos don't silently drop a persona.
func parseMix(spec string, known []string) ([]weight, error) {
	var mix []weight
	for part := range strings.SplitSeq(spec, ",") {
		name, value, _ := strings.Cut(strings.TrimSpace(part), "=")
		w, err := strconv.ParseFloat(value, 64)
		if err != nil || w < 0 || !slices.Contains(known, name) {
			return nil, fmt.Errorf("mix %q: want name=weight with names from %s", part, strings.Join(known, ", "))
		}
		mix = append(mix, weight{name, w})
	}
	return mix, nil
}

func pickWeighted(mix []weight, rng *rand.Rand) string {
	total := 0.0
	for _, w := range mix {
		total += w.weight
	}
	roll := rng.Float64() * total
	for _, w := range mix {
		if roll -= w.weight; roll < 0 {
			return w.name
		}
	}
	return mix[len(mix)-1].name
}
