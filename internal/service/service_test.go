package service_test

import (
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
	"github.com/mushroom11s/tailcat-desktop-client/internal/service"
	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
)

func TestStartPipeServeReady(t *testing.T) {
	svc := service.New(adapter.NewFake())
	sess, err := svc.StartPipeServe()
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for {
		list := svc.List()
		for _, item := range list {
			if item.ID == sess.ID && item.Status == session.StatusRunning && item.Address != "" {
				return
			}
		}
		select {
		case <-deadline:
			t.Fatalf("never running: %+v", svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestDialPipeEchoAndStop(t *testing.T) {
	svc := service.New(adapter.NewFake())
	serveSess, err := svc.StartPipeServe()
	if err != nil {
		t.Fatal(err)
	}

	var addr string
	deadline := time.After(2 * time.Second)
waitReady:
	for {
		for _, item := range svc.List() {
			if item.ID == serveSess.ID && item.Status == session.StatusRunning && item.Address != "" {
				addr = item.Address
				break waitReady
			}
		}
		select {
		case <-deadline:
			t.Fatalf("serve never ready: %+v", svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}

	dialSess, err := svc.DialPipe(addr, "hello")
	if err != nil {
		t.Fatal(err)
	}

	events := svc.Events()
	gotEcho := false
	dialDeadline := time.After(2 * time.Second)
	for !gotEcho {
		select {
		case ev := <-events:
			if ev.SessionID == dialSess.ID && ev.Kind == adapter.EventData {
				if !strings.HasPrefix(ev.Data, "echo:hello") {
					t.Fatalf("data=%q", ev.Data)
				}
				gotEcho = true
			}
		case <-dialDeadline:
			t.Fatal("timeout waiting for dial echo")
		}
	}

	stopDeadline := time.After(2 * time.Second)
waitDialStopped:
	for {
		for _, item := range svc.List() {
			if item.ID == dialSess.ID && item.Status == session.StatusStopped {
				break waitDialStopped
			}
		}
		select {
		case <-stopDeadline:
			t.Fatalf("dial never stopped: %+v", svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}

	if err := svc.Stop(serveSess.ID); err != nil {
		t.Fatal(err)
	}

	serveStopDeadline := time.After(2 * time.Second)
	for {
		for _, item := range svc.List() {
			if item.ID == serveSess.ID && item.Status == session.StatusStopped {
				return
			}
		}
		select {
		case <-serveStopDeadline:
			t.Fatalf("serve never stopped: %+v", svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}
}
