package db

import (
	"time"

	"golang.org/x/sys/unix"
)

// TCP_USER_TIMEOUT also ends sockets with unacknowledged data, which keepalive never probes.
func setUserTimeout(fd uintptr, timeout time.Duration) error {
	return unix.SetsockoptInt(int(fd), unix.IPPROTO_TCP, unix.TCP_USER_TIMEOUT, int(timeout.Milliseconds()))
}
