package main

import (
	"bytes"
	"fmt"
	"io"
	mrand "math/rand/v2"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

const (
	metadataPreloadBytes = 512 * 1024
	streamChunkBytes     = 1024 * 1024
)

type clip struct {
	name string
	data []byte
}

var clips []clip

func loadClips() {
	for _, file := range []string{"clip-small.mp4", "clip-large.mp4"} {
		data, err := os.ReadFile(filepath.Join(*videoDir, file))
		if err != nil {
			fmt.Println("video clips missing:", err)
			os.Exit(1)
		}
		clips = append(clips, clip{file, data})
	}
}

// rangeGet fetches one byte range like a <video> element and returns the bytes read and the file size.
func (c *client) rangeGet(label, path string, from, to int64) (int64, int64) {
	if slices.Contains(strings.Split(*skip, ","), label) {
		return 0, 0
	}
	req, _ := http.NewRequest("GET", *baseURL+path, nil)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", from, to))
	req.Header.Set("Cookie", c.cookie)
	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		record(label, 0, "neterr")
		return 0, 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK {
		record(label, 0, fmt.Sprint(resp.StatusCode))
		return 0, 0
	}
	read, _ := io.Copy(io.Discard, resp.Body)
	record(label, time.Since(start), "")
	countTraffic(label, requestSize(req), responseSize(resp, int(read)))
	var total int64
	if _, err := fmt.Sscanf(resp.Header.Get("Content-Range"), "bytes %d-%d/%d", new(int64), new(int64), &total); err != nil {
		total = read
	}
	return read, total
}

// previewVideos mirrors preload="metadata" of every file beta on a route page.
func (c *client) previewVideos(route string) {
	for _, path := range videosOf(route) {
		c.rangeGet("video:metadata", path, 0, metadataPreloadBytes-1)
	}
}

// watch streams a clip in 1 MB ranges at twice its bitrate, like a buffering player.
func (c *client) watch(path string) {
	seconds := 15.0
	if strings.Contains(path, "clip_large") {
		seconds = 25
	}
	_, size := c.rangeGet("video:stream", path, 0, streamChunkBytes-1)
	chunkSeconds := seconds * streamChunkBytes / float64(max(size, 1))
	for from := int64(streamChunkBytes); from < size; from += streamChunkBytes {
		select {
		case <-stopSignal:
			return
		case <-time.After(time.Duration(chunkSeconds / 2 * float64(time.Second))):
		}
		c.rangeGet("video:stream", path, from, min(from+streamChunkBytes, size)-1)
	}
}

func videoRoutes(g *gym) []string {
	routes := []string{}
	for _, route := range g.routes {
		if len(videosOf(route["id"].(string))) > 0 {
			routes = append(routes, route["id"].(string))
		}
	}
	return routes
}

func viewer() {
	for !stopping.Load() {
		c := newClient(randomGym())
		routes := videoRoutes(c.gym)
		if len(routes) == 0 {
			c.end()
			if !pause(1) {
				return
			}
			continue
		}
		route := routes[mrand.IntN(len(routes))]
		c.fullLoad("route", route, mrand.Float64() < *coldShare)
		for views := 0; views < 3 && pause(1); views++ {
			if mrand.IntN(10) < 6 {
				videos := videosOf(route)
				c.watch(videos[mrand.IntN(len(videos))])
			}
			route = routes[mrand.IntN(len(routes))]
			c.navigate("route", route)
		}
		c.end()
	}
}

func uploader(index int) {
	email, n := climberEmail()
	c := newClient(homeGym(n))
	defer c.end()
	if !c.login(email) {
		return
	}
	c.fullLoad("overview", "", true)
	for pause(float64(*uploadEvery) / float64(*think)) {
		route := c.gym.randomRoute()["id"].(string)
		c.navigate("route", route)
		c.uploadVideo(route, clips[(index+mrand.IntN(4))%len(clips)])
	}
}

func (c *client) uploadVideo(route string, chosen clip) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	_ = form.WriteField("route", route)
	_ = form.WriteField("user", c.me())
	part, _ := form.CreateFormFile("file", chosen.name)
	_, _ = part.Write(chosen.data)
	_ = form.Close()
	var created map[string]any
	label := fmt.Sprintf("write:video-upload(%dMB)", (len(chosen.data)+500_000)/1_000_000)
	if c.do(label, "POST", "/api/collections/beta_videos/records", multipartBody{body.Bytes(), form.FormDataContentType()}, &created) {
		rememberVideo(created)
		c.do("api:beta-videos", "GET", list("beta_videos", all(url.Values{"filter": {fmt.Sprintf(`route = "%s"`, route)}, "sort": {"-created"}})), nil, nil)
	}
}
