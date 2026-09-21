package main

import (
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
)

func TestStartPipeServeReturnsSession(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	a := NewApp()
	sess, err := a.StartPipeServe()
	if err != nil {
		t.Fatal(err)
	}
	if sess.ID == "" {
		t.Fatal("expected non-empty session ID")
	}
	if sess.Kind != session.KindPipeServe {
		t.Fatalf("kind=%s", sess.Kind)
	}
}

func TestAppPipeServeDialAndStop(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	a := NewApp()
	serveSess, err := a.StartPipeServe()
	if err != nil {
		t.Fatal(err)
	}

	var addr string
	deadline := time.After(2 * time.Second)
waitReady:
	for {
		for _, item := range a.ListSessions() {
			if item.ID == serveSess.ID && item.Status == session.StatusRunning && item.Address != "" {
				addr = item.Address
				break waitReady
			}
		}
		select {
		case <-deadline:
			t.Fatalf("serve never ready: %+v", a.ListSessions())
		case <-time.After(20 * time.Millisecond):
		}
	}
	if !strings.HasPrefix(addr, "tc:fake-") {
		t.Fatalf("address=%q", addr)
	}

	dialSess, err := a.DialPipe(addr, "hello")
	if err != nil {
		t.Fatal(err)
	}
	if dialSess.Kind != session.KindPipeDial {
		t.Fatalf("kind=%s", dialSess.Kind)
	}

	if err := a.StopSession(serveSess.ID); err != nil {
		t.Fatal(err)
	}

	stopDeadline := time.After(2 * time.Second)
	for {
		for _, item := range a.ListSessions() {
			if item.ID == serveSess.ID && item.Status == session.StatusStopped {
				return
			}
		}
		select {
		case <-stopDeadline:
			t.Fatalf("serve never stopped: %+v", a.ListSessions())
		case <-time.After(20 * time.Millisecond):
		}
	}
}
