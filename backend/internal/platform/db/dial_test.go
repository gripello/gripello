package db

import (
	"context"
	"net"
	"runtime"
	"testing"

	"golang.org/x/sys/unix"
)

func TestDialerBoundsDeadPeers(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("TCP_USER_TIMEOUT is Linux-only")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	conn, err := dialer().DialContext(context.Background(), "tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	raw, _ := conn.(*net.TCPConn).SyscallConn()
	var timeout, keepalive int
	raw.Control(func(fd uintptr) {
		timeout, _ = unix.GetsockoptInt(int(fd), unix.IPPROTO_TCP, unix.TCP_USER_TIMEOUT)
		keepalive, _ = unix.GetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_KEEPALIVE)
	})
	if timeout != int(deadPeerTimeout.Milliseconds()) || keepalive != 1 {
		t.Fatalf("TCP_USER_TIMEOUT = %d ms, SO_KEEPALIVE = %d", timeout, keepalive)
	}
}

func TestDialerReachesUnixSockets(t *testing.T) {
	path := t.TempDir() + "/.s.PGSQL.5432"
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	conn, err := dialer().DialContext(context.Background(), "unix", path)
	if err != nil {
		t.Fatalf("unix socket dial failed: %v", err)
	}
	conn.Close()
}
