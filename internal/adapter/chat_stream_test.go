package adapter

import (
	"io"
	"net"
	"testing"
	"time"
)

type scriptConn struct {
	writes [][]byte
	half   bool
	closed bool
}

func (c *scriptConn) Read(p []byte) (int, error) { return 0, io.EOF }
func (c *scriptConn) Write(p []byte) (int, error) {
	c.writes = append(c.writes, append([]byte(nil), p...))
	return len(p), nil
}
func (c *scriptConn) Close() error                     { c.closed = true; return nil }
func (c *scriptConn) CloseWrite() error                { c.half = true; return nil }
func (c *scriptConn) LocalAddr() net.Addr              { return nil }
func (c *scriptConn) RemoteAddr() net.Addr             { return nil }
func (c *scriptConn) SetDeadline(time.Time) error      { return nil }
func (c *scriptConn) SetReadDeadline(time.Time) error  { return nil }
func (c *scriptConn) SetWriteDeadline(time.Time) error { return nil }

func TestWriteAndHalfCloseUses64KiBSlices(t *testing.T) {
	frame := make([]byte, 64*1024+100)
	for i := range frame {
		frame[i] = byte(i)
	}
	conn := &scriptConn{}
	if err := writeAndHalfClose(conn, frame); err != nil {
		t.Fatal(err)
	}
	if len(conn.writes) != 2 || len(conn.writes[0]) != 64*1024 || len(conn.writes[1]) != 100 {
		t.Fatalf("writes=%d", len(conn.writes))
	}
	if !conn.half || !conn.closed {
		t.Fatalf("half=%v closed=%v", conn.half, conn.closed)
	}
}
