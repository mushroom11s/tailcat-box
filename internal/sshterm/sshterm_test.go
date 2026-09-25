package sshterm

import (
	"bytes"
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func TestBridgeCopiesAfterToken(t *testing.T) {
	b, err := Listen()
	if err != nil {
		t.Fatal(err)
	}
	remoteR, remoteW := io.Pipe()
	clientR, clientW := io.Pipe()
	remote := &joinRW{r: clientR, w: remoteW}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- b.Serve(ctx, remote)
	}()

	conn, err := net.Dial("tcp", b.Addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("nope\n")); err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "rejected") {
			t.Fatalf("err=%v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}
	_ = remoteR.Close()
	_ = clientW.Close()
}

func TestBridgeRoundTrip(t *testing.T) {
	b, err := Listen()
	if err != nil {
		t.Fatal(err)
	}
	pr, pw := io.Pipe()
	cr, cw := io.Pipe()
	remote := &joinRW{r: cr, w: pw}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = b.Serve(ctx, remote)
	}()

	conn, err := net.Dial("tcp", b.Addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(b.Token + "\nhi")); err != nil {
		t.Fatal(err)
	}
	got := make(chan string, 1)
	go func() {
		buf := make([]byte, 8)
		n, err := pr.Read(buf)
		if err != nil {
			got <- "err:" + err.Error()
			return
		}
		got <- string(buf[:n])
	}()
	select {
	case s := <-got:
		if s != "hi" {
			t.Fatalf("remote got %q", s)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for remote")
	}
	if _, err := cw.Write([]byte("yo")); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	reply := make([]byte, 8)
	n, err := conn.Read(reply)
	if err != nil {
		t.Fatal(err)
	}
	if string(reply[:n]) != "yo" {
		t.Fatalf("terminal got %q", reply[:n])
	}
}

func TestTerminalArgs(t *testing.T) {
	bin, args, err := terminalArgs("windows", `C:\Program Files\tailcat-box.exe`, "127.0.0.1:9", "tok", nil)
	if err != nil {
		t.Fatal(err)
	}
	if bin != "cmd.exe" || len(args) < 4 || args[0] != "/c" || args[1] != "start" || args[2] != "Tailcat SSH" {
		t.Fatalf("windows %s %v", bin, args)
	}
	if !strings.Contains(strings.Join(args, " "), AttachArg) {
		t.Fatalf("args %v", args)
	}

	bin, args, err = terminalArgs("darwin", "/Applications/Tailcat Box.app/Contents/MacOS/tailcat-box", "127.0.0.1:9", "tok", nil)
	if err != nil {
		t.Fatal(err)
	}
	if bin != "osascript" || !strings.Contains(strings.Join(args, " "), "Terminal") || !strings.Contains(args[1], AttachArg) {
		t.Fatalf("darwin %s %v", bin, args)
	}

	look := func(name string) (string, error) {
		if name == "xterm" {
			return "/usr/bin/xterm", nil
		}
		return "", osMissing(name)
	}
	bin, args, err = terminalArgs("linux", "/usr/local/bin/tailcat-box", "127.0.0.1:9", "tok", look)
	if err != nil {
		t.Fatal(err)
	}
	if bin != "/usr/bin/xterm" || args[0] != "-e" {
		t.Fatalf("linux %s %v", bin, args)
	}

	_, _, err = terminalArgs("linux", "tailcat-box", "127.0.0.1:9", "tok", func(name string) (string, error) {
		return "", osMissing(name)
	})
	if err == nil || !strings.Contains(err.Error(), "no system terminal") {
		t.Fatalf("err=%v", err)
	}
}

type osMissing string

func (o osMissing) Error() string { return "missing " + string(o) }

type joinRW struct {
	r io.Reader
	w io.Writer
}

func (j *joinRW) Read(p []byte) (int, error)  { return j.r.Read(p) }
func (j *joinRW) Write(p []byte) (int, error) { return j.w.Write(p) }
func (j *joinRW) Close() error {
	if c, ok := j.w.(io.Closer); ok {
		_ = c.Close()
	}
	if c, ok := j.r.(io.Closer); ok {
		return c.Close()
	}
	return nil
}

func TestRejectedTokenDoesNotCopy(t *testing.T) {
	b, err := Listen()
	if err != nil {
		t.Fatal(err)
	}
	var got bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- b.Serve(ctx, nopCloser{&got})
	}()
	conn, err := net.Dial("tcp", b.Addr)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = conn.Write([]byte("wrong\nsecret"))
	_ = conn.Close()
	if err := <-done; err == nil || !strings.Contains(err.Error(), "rejected") {
		t.Fatalf("err=%v", err)
	}
	if got.Len() != 0 {
		t.Fatalf("copied %q", got.String())
	}
}

type nopCloser struct{ io.Writer }

func (nopCloser) Read([]byte) (int, error) { return 0, io.EOF }
func (nopCloser) Close() error             { return nil }
