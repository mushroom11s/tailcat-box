package main

import (
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
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

func TestAppPlan2Bindings(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_KEYS_DIR", t.TempDir())
	a := NewApp()

	serveSess, err := a.StartPortServe([]adapter.PortMapping{{LocalPort: 8080}})
	if err != nil {
		t.Fatal(err)
	}
	if serveSess.Kind != session.KindPortServe {
		t.Fatalf("kind=%s", serveSess.Kind)
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
			t.Fatalf("port serve never ready: %+v", a.ListSessions())
		case <-time.After(20 * time.Millisecond):
		}
	}

	fwd, err := a.StartForward(addr, []adapter.PortMapping{{LocalPort: 18080, RemotePort: 8080}})
	if err != nil {
		t.Fatal(err)
	}
	if fwd.Kind != session.KindForward {
		t.Fatalf("kind=%s", fwd.Kind)
	}
	browse, err := a.StartBrowse(addr)
	if err != nil {
		t.Fatal(err)
	}
	if browse.Kind != session.KindBrowse {
		t.Fatalf("kind=%s", browse.Kind)
	}
	ping, err := a.StartPing(addr, true)
	if err != nil {
		t.Fatal(err)
	}
	if ping.Kind != session.KindPing {
		t.Fatalf("kind=%s", ping.Kind)
	}

	parsed, err := a.ParseAddr(addr)
	if err != nil {
		t.Fatal(err)
	}
	if parsed == "" {
		t.Fatal("empty parse")
	}
	resolved, err := a.ResolveAddr(addr)
	if err != nil {
		t.Fatal(err)
	}
	if resolved == "" {
		t.Fatal("empty resolve")
	}

	keyAddr, err := a.CreateKey("home", false, "nyc")
	if err != nil {
		t.Fatal(err)
	}
	if keyAddr == "" {
		t.Fatal("empty key address")
	}
	keys, err := a.ListKeys()
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || keys[0].Name != "home" {
		t.Fatalf("%+v", keys)
	}
	if err := a.DeleteKey("home"); err != nil {
		t.Fatal(err)
	}
}

func TestAppPlan3Bindings(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	a := NewApp()
	inbox := t.TempDir()
	root := t.TempDir()

	recv, err := a.StartRecv(inbox, false)
	if err != nil {
		t.Fatal(err)
	}
	if recv.Kind != session.KindRecv {
		t.Fatalf("kind=%s", recv.Kind)
	}

	serve, err := a.StartFilesServe(root, "ro")
	if err != nil {
		t.Fatal(err)
	}
	if serve.Kind != session.KindFilesServe {
		t.Fatalf("kind=%s", serve.Kind)
	}

	var addr string
	deadline := time.After(2 * time.Second)
waitReady:
	for {
		for _, item := range a.ListSessions() {
			if item.ID == serve.ID && item.Status == session.StatusRunning && item.Address != "" {
				addr = item.Address
				break waitReady
			}
		}
		select {
		case <-deadline:
			t.Fatalf("files serve never ready: %+v", a.ListSessions())
		case <-time.After(20 * time.Millisecond):
		}
	}

	entries, err := a.ListRemote(addr, ".")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("expected listing")
	}

	cp, err := a.StartCopy(addr, []string{"hello.txt"}, ".")
	if err != nil {
		t.Fatal(err)
	}
	if cp.Kind != session.KindCopy {
		t.Fatalf("kind=%s", cp.Kind)
	}

	if _, err := a.SelectDirectory("Inbox"); err == nil {
		t.Fatal("expected picker error without a window")
	}
	if _, err := a.SelectFiles("Send"); err == nil {
		t.Fatal("expected picker error without a window")
	}
}
