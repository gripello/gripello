//go:build !linux

package db

import "time"

func setUserTimeout(uintptr, time.Duration) error { return nil }
