package service_test

import (
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/service"
	"github.com/mushroom11s/tailcat-box/internal/session"
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

	fwdSess, err := svc.StartForward(ready.Address, []adapter.PortMapping{{LocalPort: 18080, RemotePort: 8080}}, false)
	if err != nil {
		t.Fatal(err)
	}
	if fwdSess.Kind != session.KindForward {
		t.Fatalf("kind=%s", fwdSess.Kind)
	}
	waitRunning(t, svc, fwdSess.ID)

	openSess, err := svc.StartForward(ready.Address, []adapter.PortMapping{{LocalPort: 0, RemotePort: 80}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if openSess.Kind != session.KindForward {
		t.Fatalf("kind=%s", openSess.Kind)
	}
	openReady := waitRunning(t, svc, openSess.ID)
	if !strings.HasPrefix(openReady.Address, "http://") {
		t.Fatalf("open browser address=%q", openReady.Address)
	}

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
	if err := svc.Stop(openSess.ID); err != nil {
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

func TestStartSSHServeRequiresDangerConfirm(t *testing.T) {
	svc := service.New(adapter.NewFake())
	if _, err := svc.StartSSHServe(adapter.SSHServeOpts{NoAuth: true}, false); err == nil {
		t.Fatal("expected no-auth confirmation error")
	}
	if _, err := svc.StartSSHServe(adapter.SSHServeOpts{}, false); err == nil {
		t.Fatal("expected authorized keys error")
	}

	sess, err := svc.StartSSHServe(adapter.SSHServeOpts{NoAuth: true}, true)
	if err != nil {
		t.Fatal(err)
	}
	if sess.Kind != session.KindSSHServe {
		t.Fatalf("kind=%s", sess.Kind)
	}
	if !sess.Dangerous {
		t.Fatal("expected dangerous session")
	}
	ready := waitRunning(t, svc, sess.ID)
	if !strings.HasPrefix(ready.Address, "tc:fake-noauth-ssh-") {
		t.Fatalf("addr=%q", ready.Address)
	}

	keyed, err := svc.StartSSHServe(adapter.SSHServeOpts{AuthorizedKeys: "ssh-ed25519 AAAA test"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if keyed.Dangerous {
		t.Fatal("keyed ssh should not be marked dangerous")
	}
	waitRunning(t, svc, keyed.ID)
}

func TestStartSSHClientSOCKSExitExec(t *testing.T) {
	svc := service.New(adapter.NewFake())
	if _, err := svc.StartSSHClient("", adapter.SSHClientOpts{}); err == nil {
		t.Fatal("expected empty addr error")
	}
	if _, err := svc.StartSOCKS("", ""); err == nil {
		t.Fatal("expected empty addr error")
	}
	if _, err := svc.StartExec(nil); err == nil {
		t.Fatal("expected empty exec error")
	}

	ssh, err := svc.StartSSHServe(adapter.SSHServeOpts{NoAuth: true}, true)
	if err != nil {
		t.Fatal(err)
	}
	ready := waitRunning(t, svc, ssh.ID)

	client, err := svc.StartSSHClient(ready.Address, adapter.SSHClientOpts{Command: "whoami"})
	if err != nil {
		t.Fatal(err)
	}
	if client.Kind != session.KindSSHClient {
		t.Fatalf("kind=%s", client.Kind)
	}
	prog := waitProgress(t, svc, client.ID)
	if !strings.Contains(prog.Progress, "whoami") {
		t.Fatalf("progress=%q", prog.Progress)
	}

	exitSess, err := svc.StartExitNode()
	if err != nil {
		t.Fatal(err)
	}
	if exitSess.Kind != session.KindExitNode {
		t.Fatalf("kind=%s", exitSess.Kind)
	}
	exitReady := waitRunning(t, svc, exitSess.ID)

	socks, err := svc.StartSOCKS(exitReady.Address, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if socks.Kind != session.KindSOCKS {
		t.Fatalf("kind=%s", socks.Kind)
	}
	waitRunning(t, svc, socks.ID)

	execSess, err := svc.StartExec([]string{"/bin/echo", "hi"})
	if err != nil {
		t.Fatal(err)
	}
	if execSess.Kind != session.KindExec {
		t.Fatalf("kind=%s", execSess.Kind)
	}
	waitRunning(t, svc, execSess.ID)
}

func TestSSHDeskAllowlistRejectsStrangers(t *testing.T) {
	svc := service.New(adapter.NewFake())
	desk, err := svc.StartSSHDesk(adapter.SSHServeOpts{
		IdentityJSON:    `{"fake":"desk"}`,
		AllowedNodeKeys: []string{"nodekey:tc:laptop"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if desk.Dangerous {
		t.Fatal("allowlist SSH should not be marked dangerous")
	}
	ready := waitRunning(t, svc, desk.ID)
	if !strings.HasPrefix(ready.Address, "tc:fake-noauth-ssh-desk-") {
		t.Fatalf("address=%q", ready.Address)
	}

	denied, err := svc.StartSSHClient(ready.Address, adapter.SSHClientOpts{
		Interactive:   true,
		NoClientAuth:  true,
		ClientNodeKey: "nodekey:tc:other",
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for {
		for _, item := range svc.List() {
			if item.ID == denied.ID && item.Status == session.StatusError {
				if !strings.Contains(item.Err, "allowlist") {
					t.Fatalf("err=%q", item.Err)
				}
				goto allowed
			}
		}
		select {
		case <-deadline:
			t.Fatalf("denied client never failed: %+v", svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}
allowed:
	client, err := svc.StartSSHClient(ready.Address, adapter.SSHClientOpts{
		Interactive:   true,
		NoClientAuth:  true,
		ClientNodeKey: "nodekey:tc:laptop",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitRunning(t, svc, client.ID)
	if err := svc.WriteSSH(client.ID, "hi"); err != nil {
		t.Fatal(err)
	}
	prog := waitProgress(t, svc, client.ID)
	if !strings.Contains(prog.Progress, "hi") && prog.Progress != "hi" {
		// connected arrives first; keep reading until the echo lands
		deadline = time.After(2 * time.Second)
		for !strings.Contains(prog.Progress, "hi") {
			select {
			case <-deadline:
				t.Fatalf("progress=%q", prog.Progress)
			case <-time.After(20 * time.Millisecond):
			}
			for _, item := range svc.List() {
				if item.ID == client.ID {
					prog = item
				}
			}
		}
	}
}

func TestSSHDeskAllowAnyIsDangerous(t *testing.T) {
	svc := service.New(adapter.NewFake())
	sess, err := svc.StartSSHDesk(adapter.SSHServeOpts{AllowAny: true, IdentityJSON: `{"fake":"open"}`})
	if err != nil {
		t.Fatal(err)
	}
	if !sess.Dangerous {
		t.Fatal("allow-any SSH should be marked dangerous")
	}
	ready := waitRunning(t, svc, sess.ID)
	client, err := svc.StartSSHClient(ready.Address, adapter.SSHClientOpts{Interactive: true, NoClientAuth: true})
	if err != nil {
		t.Fatal(err)
	}
	waitRunning(t, svc, client.ID)
}
