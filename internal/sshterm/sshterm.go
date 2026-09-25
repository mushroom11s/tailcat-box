// Package sshterm attaches a system terminal to an interactive Tailcat SSH shell.
// The child process is this same binary started with --tailcat-box-ssh-attach.
package sshterm

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"golang.org/x/term"
)

const AttachArg = "--tailcat-box-ssh-attach"

// HandleArgs runs the terminal attach child and reports whether args selected it.
// A failed attach exits the process.
func HandleArgs(args []string) bool {
	if len(args) != 3 || args[0] != AttachArg {
		return false
	}
	if err := Attach(args[1], args[2]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	return true
}

// Bridge is a localhost listener that copies one authenticated connection
// to and from an SSH session.
type Bridge struct {
	Addr  string
	Token string
	ln    net.Listener
}

// Listen starts a 127.0.0.1 bridge with a random token.
func Listen() (*Bridge, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		_ = ln.Close()
		return nil, err
	}
	return &Bridge{Addr: ln.Addr().String(), Token: hex.EncodeToString(buf), ln: ln}, nil
}

func (b *Bridge) Close() error {
	if b == nil || b.ln == nil {
		return nil
	}
	return b.ln.Close()
}

// Serve accepts one connection, checks the token line, then copies bytes
// until either side closes. remote is the interactive SSH session.
func (b *Bridge) Serve(ctx context.Context, remote io.ReadWriteCloser) error {
	defer b.Close()
	defer remote.Close()
	accept := make(chan net.Conn, 1)
	errCh := make(chan error, 1)
	go func() {
		c, err := b.ln.Accept()
		if err != nil {
			errCh <- err
			return
		}
		accept <- c
	}()
	var conn net.Conn
	select {
	case <-ctx.Done():
		_ = b.Close()
		return ctx.Err()
	case err := <-errCh:
		return err
	case conn = <-accept:
	}
	defer conn.Close()
	reader := bufio.NewReader(conn)
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	line, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("ssh terminal handshake: %w", err)
	}
	if strings.TrimSpace(line) != b.Token {
		return fmt.Errorf("ssh terminal rejected")
	}
	_ = conn.SetDeadline(time.Time{})
	errc := make(chan error, 2)
	go func() {
		_, copyErr := io.Copy(remote, reader)
		errc <- copyErr
	}()
	go func() {
		_, copyErr := io.Copy(conn, remote)
		errc <- copyErr
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errc:
		if err == io.EOF {
			return nil
		}
		return err
	}
}

// Attach connects to a bridge, sends token, and copies the console.
func Attach(addr, token string) error {
	if err := prepareConsole(); err != nil {
		return err
	}
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(conn, "%s\n", token); err != nil {
		return err
	}
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		old, err := term.MakeRaw(fd)
		if err != nil {
			return err
		}
		defer term.Restore(fd, old)
	}
	errc := make(chan error, 2)
	go func() {
		_, copyErr := io.Copy(conn, os.Stdin)
		errc <- copyErr
	}()
	go func() {
		_, copyErr := io.Copy(os.Stdout, conn)
		errc <- copyErr
	}()
	err = <-errc
	if err == io.EOF {
		return nil
	}
	return err
}
