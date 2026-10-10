package blob

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Sizes from the PocketBase file fields' thumbs options plus the 100x100 default PocketBase always allowed.
var thumbSizes = []string{"16x16", "32x32", "48x48", "80x80", "100x100", "320x320", "0x200", "400x0", "800x300", "1600x400", "1600x500"}

// A 25 MP source decodes to ~100 MB RGBA; thumbSlots caps how many decode at once on this replica.
const maxThumbSourcePixels = 25_000_000

var thumbSlots = make(chan struct{}, 4)

var thumbSize = regexp.MustCompile(`^(\d+)x(\d+)([tbf])?$`)

// Without the vips CLI (local dev) thumbs fall back to the pure-Go resizer.
var vipsPath, _ = exec.LookPath("vips")

// WarmThumbs renders sizes in the background so the first viewer of a fresh upload gets a cached thumb.
func (s *Store) WarmThumbs(key string, sizes ...string) {
	for _, size := range sizes {
		s.warming.Go(func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			if _, err := s.Thumb(ctx, key, size); err != nil {
				slog.Warn("thumb warm-up failed", "key", key, "size", size, "error", err)
			}
		})
	}
}

// Thumb returns the key to serve for size: a cached or freshly generated thumb, or the original for unknown sizes and non-raster files.
func (s *Store) Thumb(ctx context.Context, key, size string) (string, error) {
	match := thumbSize.FindStringSubmatch(size)
	if match == nil || !slices.Contains(thumbSizes, match[1]+"x"+match[2]) {
		return key, nil
	}
	dir, name := path.Split(key)
	thumbKey := dir + "thumbs_" + name + "/" + size + "_" + name
	if _, err := s.root.Stat(thumbKey); err == nil {
		return thumbKey, nil
	}
	select {
	case thumbSlots <- struct{}{}:
		defer func() { <-thumbSlots }()
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if _, err := s.root.Stat(thumbKey); err == nil {
		return thumbKey, nil
	}
	f, err := s.root.Open(key)
	if err != nil {
		return "", err
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	format := Sniff(head[:n])
	if format != "image/jpeg" && format != "image/png" && format != "image/webp" {
		return key, nil
	}
	f.Seek(0, io.SeekStart)
	config, _, err := image.DecodeConfig(f)
	if err != nil || config.Width*config.Height > maxThumbSourcePixels {
		return key, nil
	}
	width, _ := strconv.Atoi(match[1])
	height, _ := strconv.Atoi(match[2])
	if vipsPath != "" {
		if err := s.vipsThumb(ctx, key, thumbKey, format, width, height, match[3]); err != nil {
			slog.Warn("vips thumbnail failed, serving the original", "key", key, "error", err)
			return key, nil
		}
		return thumbKey, nil
	}
	f.Seek(0, io.SeekStart)
	src, _, err := image.Decode(f)
	if err != nil {
		return key, nil
	}
	thumb := resize(src, width, height, match[3])
	var out bytes.Buffer
	if format == "image/jpeg" {
		err = jpeg.Encode(&out, thumb, &jpeg.Options{Quality: 85})
	} else {
		err = png.Encode(&out, thumb)
	}
	if err != nil {
		return "", err
	}
	return thumbKey, s.Put(ctx, thumbKey, &out)
}

var vipsOutputs = map[string]struct{ ext, options string }{
	"image/jpeg": {".jpg", "[Q=85,keep=icc]"},
	"image/png":  {".png", "[keep=icc]"},
	"image/webp": {".webp", "[keep=icc]"},
}

func (s *Store) vipsThumb(ctx context.Context, key, thumbKey, format string, width, height int, mode string) error {
	tmp, err := os.MkdirTemp("", "thumb")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	src, err := s.root.Open(key)
	if err != nil {
		return err
	}
	defer src.Close()
	output := vipsOutputs[format]
	out := filepath.Join(tmp, "out"+output.ext)
	// The source goes in on stdin so the read stays inside the store's os.Root.
	cmd := exec.CommandContext(ctx, vipsPath, vipsArgs(out+output.options, width, height, mode)...)
	cmd.Stdin = src
	if combined, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s", err, combined)
	}
	f, err := os.Open(out)
	if err != nil {
		return err
	}
	defer f.Close()
	return s.Put(ctx, thumbKey, f)
}

// vipsArgs mirrors resize: 0 sides become unbounded, f fits without upscaling, t/b crop from the low/high edge.
func vipsArgs(out string, width, height int, mode string) []string {
	const unbounded = "10000000"
	w, h := strconv.Itoa(width), strconv.Itoa(height)
	if width == 0 {
		w = unbounded
	}
	if height == 0 {
		h = unbounded
	}
	args := []string{"thumbnail_source", "[descriptor=0]", out, w, "--height", h}
	switch {
	case width == 0 || height == 0:
	case mode == "f":
		args = append(args, "--size", "down")
	case mode == "t":
		args = append(args, "--crop", "low")
	case mode == "b":
		args = append(args, "--crop", "high")
	default:
		args = append(args, "--crop", "centre")
	}
	return args
}

// resize follows PocketBase: WxH crops to fill from the centre (t: top, b: bottom), WxHf fits inside, a 0 side keeps the ratio.
func resize(src image.Image, width, height int, mode string) image.Image {
	bounds := src.Bounds()
	srcW, srcH := bounds.Dx(), bounds.Dy()
	if srcW == 0 || srcH == 0 || width == 0 && height == 0 {
		return src
	}
	crop := bounds
	switch {
	case width == 0:
		width = max(1, srcW*height/srcH)
	case height == 0:
		height = max(1, srcH*width/srcW)
	case mode == "f" && srcW <= width && srcH <= height:
		return src
	case mode == "f":
		if srcW*height > srcH*width {
			height = max(1, srcH*width/srcW)
		} else {
			width = max(1, srcW*height/srcH)
		}
	default:
		if srcW*height > srcH*width {
			cropW := srcH * width / height
			offset := (srcW - cropW) / 2
			crop = image.Rect(bounds.Min.X+offset, bounds.Min.Y, bounds.Min.X+offset+cropW, bounds.Max.Y)
		} else {
			cropH := srcW * height / width
			offset := (srcH - cropH) / 2
			if mode == "t" {
				offset = 0
			} else if mode == "b" {
				offset = srcH - cropH
			}
			crop = image.Rect(bounds.Min.X, bounds.Min.Y+offset, bounds.Max.X, bounds.Min.Y+offset+cropH)
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Src, nil)
	return dst
}
