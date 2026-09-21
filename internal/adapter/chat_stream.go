package adapter

import (
	"io"
	"net"
)

const streamSlice = 64 * 1024

func writeAndHalfClose(conn net.Conn, frame []byte) error {
	for len(frame) > 0 {
		n := streamSlice
		if n > len(frame) {
			n = len(frame)
		}
		if _, err := conn.Write(frame[:n]); err != nil {
			return err
		}
		frame = frame[n:]
	}
	if cw, ok := conn.(interface{ CloseWrite() error }); ok {
		if err := cw.CloseWrite(); err != nil {
			return err
		}
	}
	_, _ = io.Copy(io.Discard, conn)
	return conn.Close()
}
