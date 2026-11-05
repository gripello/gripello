package db

import (
	"net"
	"strings"
	"syscall"
	"time"
)

// deadPeerTimeout bounds how long a socket to a vanished primary (hard host failure, failover) keeps a query or pooled connection waiting.
const deadPeerTimeout = 15 * time.Second

func dialer() *net.Dialer {
	return &net.Dialer{
		KeepAliveConfig: net.KeepAliveConfig{Enable: true, Idle: 5 * time.Second, Interval: 2 * time.Second, Count: 5},
		Control: func(network, address string, raw syscall.RawConn) error {
			if !strings.HasPrefix(network, "tcp") {
				return nil
			}
			var sockErr error
			err := raw.Control(func(fd uintptr) { sockErr = setUserTimeout(fd, deadPeerTimeout) })
			if err != nil {
				return err
			}
			return sockErr
		},
	}
}
