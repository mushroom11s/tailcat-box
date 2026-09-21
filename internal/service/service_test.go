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

func waitRunning(t *testing.T, svc *service.Service, id string) session.Session {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		for _, item := range svc.List() {
			if item.ID == id && item.Status == session.StatusRunning && item.Address != "" {
				return item
			}
		}
		select {
		case <-deadline:
			t.Fatalf("never running %s: %+v", id, svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestStartPortServeThenForward(t *testing.T) {
	svc := service.New(adapter.NewFake())
	serveSess, err := svc.StartPortServe([]adapter.PortMapping{{LocalPort: 8080}})
	if err != nil {
		t.Fatal(err)
	}
	if serveSess.Kind != session.KindPortServe {
		t.Fatalf("kind=%s", serveSess.Kind)
	}
	ready := waitRunning(t, svc, serveSess.ID)

	fwdSess, err := svc.StartForward(ready.Address, []adapter.PortMapping{{LocalPort: 18080, RemotePort: 8080}})
	if err != nil {
		t.Fatal(err)
	}
	if fwdSess.Kind != session.KindForward {
		t.Fatalf("kind=%s", fwdSess.Kind)
	}
	waitRunning(t, svc, fwdSess.ID)

	browseSess, err := svc.StartBrowse(ready.Address)
	if err != nil {
		t.Fatal(err)
	}
	if browseSess.Kind != session.KindBrowse {
		t.Fatalf("kind=%s", browseSess.Kind)
	}
	waitRunning(t, svc, browseSess.ID)

	if err := svc.Stop(fwdSess.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Stop(browseSess.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Stop(serveSess.ID); err != nil {
		t.Fatal(err)
	}
}

func TestStartPingUntilDirect(t *testing.T) {
	svc := service.New(adapter.NewFake())
	sess, err := svc.StartPing("tc:fake-port-x", true)
	if err != nil {
		t.Fatal(err)
	}
	if sess.Kind != session.KindPing {
		t.Fatalf("kind=%s", sess.Kind)
	}

	events := svc.Events()
	var data []string
	gotClosed := false
	deadline := time.After(2 * time.Second)
	for !gotClosed {
		select {
		case ev := <-events:
			if ev.SessionID != sess.ID {
				continue
			}
			if ev.Kind == adapter.EventData {
				data = append(data, ev.Data)
			}
			if ev.Kind == adapter.EventClosed {
				gotClosed = true
			}
		case <-deadline:
			t.Fatal("timeout waiting for ping")
		}
	}
	if len(data) != 2 {
		t.Fatalf("data=%v", data)
	}
	if !strings.Contains(strings.ToLower(data[0]), "derp") {
		t.Fatalf("first=%q", data[0])
	}
	if !strings.Contains(strings.ToLower(data[1]), "direct") {
		t.Fatalf("second=%q", data[1])
	}
}
