package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync/atomic"
	"time"
)

var (
	baseURL     = flag.String("base", "https://localhost", "Gripello base URL")
	gymCount    = flag.Int("gyms", 20, "seeded gyms (load-<n>)")
	seededUsers = flag.Int("users", 5000, "seeded accounts (load-<n>@gripello.test); the last 100 are setters")
	guests      = flag.Int("guests", 500, "anonymous visitors added per step")
	climbers    = flag.Int("climbers", 400, "signed-in climbers added per step")
	competitors = flag.Int("competitors", 50, "climbers scoring in their gym's open competition, added per step")
	spectators  = flag.Int("spectators", 50, "guests watching live competition results, added per step")
	viewers     = flag.Int("viewers", 0, "guests watching beta videos, added per step")
	setters     = flag.Int("setters", 20, "routesetters on the manage pages, started once")
	judges      = flag.Int("judges", 0, "judges on the judge page, started once")
	tvs         = flag.Int("tvs", 0, "competition TV screens, started once")
	uploaders   = flag.Int("uploaders", 0, "climbers uploading beta videos, started once")
	uploadEvery = flag.Duration("upload-every", 2*time.Minute, "mean time between one uploader's videos")
	scoreEvery  = flag.Duration("score-every", 90*time.Second, "mean time between one competitor's or judge's scores")
	coldShare   = flag.Float64("cold", 0.3, "share of sessions that start without cached static assets")
	hardShare   = flag.Float64("hard", 0.15, "share of views that are full page loads (reload, QR, push link)")
	assetsFile  = flag.String("assets", "", "file listing the static paths a cold visit loads (build specific)")
	videoDir    = flag.String("video-dir", "videos", "directory with clip-small.mp4 and clip-large.mp4")
	steps       = flag.Int("steps", 1, "how often to add the per-step users")
	stepEvery   = flag.Duration("step-every", 3*time.Minute, "time per step, ramp included")
	ramp        = flag.Duration("ramp", time.Minute, "time to start one step's users")
	think       = flag.Duration("think", 10*time.Second, "mean think time between page views")
	tickEvery   = flag.Int("tick-every", 3, "a climber logs a tick every n page views, 0 = never")
	password    = flag.String("password", "LoadPassw0rd!", "seeded climber password")
	skip        = flag.String("skip", "", "comma-separated request labels to leave out")
	showErrors  = flag.Bool("show-errors", false, "print the first response body of each failing request label and status")
	maxErrors   = flag.Float64("max-errors", 0.02, "stop after a step whose error rate exceeds this")
	maxP95      = flag.Duration("max-p95", 2*time.Second, "stop after a step whose overall p95 exceeds this")
)

var (
	stopSignal  = make(chan struct{})
	activeUsers atomic.Int64
)

// launch runs a persona and counts it as active only while it actually runs.
func launch(run func()) {
	go func() {
		activeUsers.Add(1)
		defer activeUsers.Add(-1)
		run()
	}()
}

func main() {
	flag.Parse()
	loadCatalog()
	if *uploaders > 0 {
		loadClips()
	}
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	begin := time.Now()

	for i := range *setters {
		launch(func() { setter(i) })
	}
	for i := range *judges {
		launch(func() { judge(i) })
	}
	for range *tvs {
		launch(tv)
	}
	for i := range *uploaders {
		launch(func() { uploader(i) })
	}
	personas := []struct {
		run   func()
		count int
	}{{guest, *guests}, {climber, *climbers}, {competitor, *competitors}, {spectator, *spectators}, {viewer, *viewers}}
	perStep := *guests + *climbers + *competitors + *spectators + *viewers
	fmt.Printf("%-5s %7s %9s %8s %8s %8s %7s %9s %9s  %s\n", "step", "users", "sse_open", "rps", "errors", "p95", "drops", "up Mbit/s", "dn Mbit/s", "slowest p95")
	for step := 1; step <= *steps; step++ {
		window.Store(newStats())
		stepStart := time.Now()
		upBefore, downBefore := trafficTotals()
		for added := 0; added < perStep; added++ {
			for _, p := range personas {
				if added*p.count/perStep != (added+1)*p.count/perStep {
					launch(p.run)
				}
			}
			time.Sleep(*ramp / time.Duration(max(1, perStep)))
		}
		select {
		case <-time.After(*stepEvery - time.Since(stepStart)):
		case <-interrupt:
			step = *steps
		}
		if open := sseOpen.Load(); open > peakSSE.Load() {
			peakSSE.Store(open)
		}
		result := window.Load().summarize()
		rate := float64(result.errors) / float64(max(1, result.requests+result.errors))
		up, down := trafficTotals()
		seconds := time.Since(stepStart).Seconds()
		fmt.Printf("%-5d %7d %9d %8.0f %7.2f%% %8s %7d %9.1f %9.1f  %v\n", step, activeUsers.Load(), sseOpen.Load(),
			float64(result.requests)/seconds, rate*100, result.p95.Round(time.Millisecond), sseDrops.Load(),
			float64(up-upBefore)*8/seconds/1e6, float64(down-downBefore)*8/seconds/1e6, result.slowest)
		if rate > *maxErrors || result.p95 > *maxP95 {
			fmt.Printf("stopping: step %d broke the limits (errors %.2f%%, p95 %s)\n", step, rate*100, result.p95.Round(time.Millisecond))
			break
		}
	}
	stopping.Store(true)
	close(stopSignal)
	elapsed := time.Since(begin)
	fmt.Printf("\n=== %s, peak sse_open=%d, sse_drops=%d ===\n", elapsed.Round(time.Second), peakSSE.Load(), sseDrops.Load())
	total.print(elapsed)
	fmt.Println()
	eventLatency.print(elapsed)
	fmt.Println()
	printEventVolume(elapsed)
	fmt.Println()
	printTraffic(elapsed)
}
