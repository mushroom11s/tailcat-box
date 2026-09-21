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

func TestListSessionsStableOrder(t *testing.T) {
	svc := service.New(adapter.NewFake())
	const n = 8
	for i := 0; i < n; i++ {
		if _, err := svc.StartPipeServe(); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.StartPortServe([]adapter.PortMapping{{LocalPort: uint16(8080 + i)}}); err != nil {
			t.Fatal(err)
		}
	}
	first := ids(svc.List())
	if len(first) != n*2 {
		t.Fatalf("got %d sessions, want %d", len(first), n*2)
	}
	list := svc.List()
	for i := 1; i < len(list); i++ {
		prev, cur := list[i-1], list[i]
		if prev.CreatedAt.After(cur.CreatedAt) {
			t.Fatalf("not sorted by CreatedAt: %s after %s", prev.ID, cur.ID)
		}
		if prev.CreatedAt.Equal(cur.CreatedAt) && prev.ID > cur.ID {
			t.Fatalf("CreatedAt tie not sorted by ID: %s then %s", prev.ID, cur.ID)
		}
	}
	for i := 0; i < 40; i++ {
		got := ids(svc.List())
		if !equalIDs(first, got) {
			t.Fatalf("list order changed on poll %d\nfirst=%v\ngot=%v", i, first, got)
		}
	}
}

func ids(list []session.Session) []string {
	out := make([]string, len(list))
	for i, s := range list {
		out[i] = s.ID
	}
	return out
}

func equalIDs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestParseAndResolveAddr(t *testing.T) {
	svc := service.New(adapter.NewFake())
	raw := "tc:example-addr"
	got, err := svc.ParseAddr(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, raw) {
		t.Fatalf("parse=%q", got)
	}
	resolved, err := svc.ResolveAddr(raw)
	if err != nil {
		t.Fatal(err)
	}
	if resolved == "" {
		t.Fatal("empty resolve")
	}
}

func waitProgress(t *testing.T, svc *service.Service, id string) session.Session {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		for _, item := range svc.List() {
			if item.ID == id && item.Progress != "" {
				return item
			}
		}
		select {
		case <-deadline:
			t.Fatalf("never progress %s: %+v", id, svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestStartRecvAndFilesServeAndCopy(t *testing.T) {
	svc := service.New(adapter.NewFake())
	inbox := t.TempDir()
	root := t.TempDir()

	recvSess, err := svc.StartRecv(inbox, false)
	if err != nil {
		t.Fatal(err)
	}
	if recvSess.Kind != session.KindRecv {
		t.Fatalf("kind=%s", recvSess.Kind)
	}
	readyRecv := waitRunning(t, svc, recvSess.ID)
	if !strings.HasPrefix(readyRecv.Address, "tc:fake-recv-") {
		t.Fatalf("addr=%q", readyRecv.Address)
	}
	dropped := waitProgress(t, svc, recvSess.ID)
	if !strings.Contains(dropped.Progress, "received") {
		t.Fatalf("progress=%q", dropped.Progress)
	}

	serveSess, err := svc.StartFilesServe(root, adapter.FilesServeOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if serveSess.Kind != session.KindFilesServe {
		t.Fatalf("kind=%s", serveSess.Kind)
	}
	readyServe := waitRunning(t, svc, serveSess.ID)

	entries, err := svc.ListRemote(readyServe.Address, ".")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("expected listing")
	}

	copySess, err := svc.StartCopy(readyServe.Address, []string{"/tmp/hello.txt"}, ".")
	if err != nil {
		t.Fatal(err)
	}
	if copySess.Kind != session.KindCopy {
		t.Fatalf("kind=%s", copySess.Kind)
	}
	prog := waitProgress(t, svc, copySess.ID)
	if !strings.Contains(prog.Progress, "copied") {
		t.Fatalf("progress=%q", prog.Progress)
	}

	if err := svc.Stop(recvSess.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Stop(serveSess.ID); err != nil {
		t.Fatal(err)
	}
}

func TestFilesValidationErrors(t *testing.T) {
	svc := service.New(adapter.NewFake())
	if _, err := svc.StartRecv("", false); err == nil {
		t.Fatal("expected empty inbox error")
	}
	if _, err := svc.StartRecv("/no/such/inbox-dir-tailcat", false); err == nil {
		t.Fatal("expected missing inbox error")
	}
	if _, err := svc.StartFilesServe("", adapter.FilesServeOpts{}); err == nil {
		t.Fatal("expected empty dir error")
	}
	if _, err := svc.StartCopy("", []string{"a.txt"}, "."); err == nil {
		t.Fatal("expected empty addr error")
	}
	if _, err := svc.StartCopy("tc:fake-files-x", nil, "."); err == nil {
		t.Fatal("expected empty paths error")
	}
	if _, err := svc.ListRemote("", "."); err == nil {
		t.Fatal("expected empty addr error")
	}
}
