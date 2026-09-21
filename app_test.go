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

func TestAppPlan4Bindings(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_KEYS_DIR", t.TempDir())
	a := NewApp()

	if _, err := a.StartSSHServe(true, "", false); err == nil {
		t.Fatal("expected no-auth confirmation error")
	}

	ssh, err := a.StartSSHServe(true, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if ssh.Kind != session.KindSSHServe || !ssh.Dangerous {
		t.Fatalf("%+v", ssh)
	}

	var addr string
	deadline := time.After(2 * time.Second)
waitReady:
	for {
		for _, item := range a.ListSessions() {
			if item.ID == ssh.ID && item.Status == session.StatusRunning && item.Address != "" {
				addr = item.Address
				break waitReady
			}
		}
		select {
		case <-deadline:
			t.Fatalf("ssh serve never ready: %+v", a.ListSessions())
		case <-time.After(20 * time.Millisecond):
		}
	}

	client, err := a.StartSSHClient(addr, "whoami", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if client.Kind != session.KindSSHClient {
		t.Fatalf("kind=%s", client.Kind)
	}

	exitSess, err := a.StartExitNode()
	if err != nil {
		t.Fatal(err)
	}
	if exitSess.Kind != session.KindExitNode {
		t.Fatalf("kind=%s", exitSess.Kind)
	}

	var exitAddr string
	deadline = time.After(2 * time.Second)
waitExit:
	for {
		for _, item := range a.ListSessions() {
			if item.ID == exitSess.ID && item.Status == session.StatusRunning && item.Address != "" {
				exitAddr = item.Address
				break waitExit
			}
		}
		select {
		case <-deadline:
			t.Fatalf("exit never ready: %+v", a.ListSessions())
		case <-time.After(20 * time.Millisecond):
		}
	}

	socks, err := a.StartSOCKS(exitAddr, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if socks.Kind != session.KindSOCKS {
		t.Fatalf("kind=%s", socks.Kind)
	}

	execSess, err := a.StartExec("/bin/echo hi")
	if err != nil {
		t.Fatal(err)
	}
	if execSess.Kind != session.KindExec {
		t.Fatalf("kind=%s", execSess.Kind)
	}

	if _, err := a.StartExec(""); err == nil {
		t.Fatal("expected empty exec error")
	}

	if err := a.SetNetworkSettings("nyc", "https://example.test/derpmap.json"); err != nil {
		t.Fatal(err)
	}
	netSettings, err := a.GetNetworkSettings()
	if err != nil {
		t.Fatal(err)
	}
	if netSettings.Region != "nyc" || netSettings.DERPMapURL != "https://example.test/derpmap.json" {
		t.Fatalf("%+v", netSettings)
	}
	if v := a.TailcatVersion(); v == "" || v == "unknown" {
		t.Fatalf("version=%q", v)
	}
}

func TestAppSettingsBindings(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_SETTINGS_DIR", t.TempDir())
	a := NewApp()

	info := a.GetClientInfo()
	if info.AppVersion == "" {
		t.Fatal("empty app version")
	}
	if info.TailcatVersion == "" || info.TailcatVersion == "unknown" {
		t.Fatalf("tailcat version=%q", info.TailcatVersion)
	}
	if info.StartedAt == "" {
		t.Fatal("empty started at")
	}
	if info.LastUpdateCheck != "" {
		t.Fatalf("expected no last check, got %q", info.LastUpdateCheck)
	}

	updated, err := a.RecordUpdateCheck()
	if err != nil {
		t.Fatal(err)
	}
	if updated.LastUpdateCheck == "" {
		t.Fatal("expected last update check timestamp")
	}

	reloaded := NewApp()
	if reloaded.GetClientInfo().LastUpdateCheck != updated.LastUpdateCheck {
		t.Fatalf("persisted check=%q want %q", reloaded.GetClientInfo().LastUpdateCheck, updated.LastUpdateCheck)
	}

	sys := a.GetSystemInfo()
	if sys.OSVersion == "" {
		t.Fatal("empty OS version")
	}
	if sys.NetworkSummary == "" {
		t.Fatal("empty network summary")
	}

	sys, err = a.SetLaunchAtLogin(true)
	if err != nil {
		t.Fatal(err)
	}
	if !sys.LaunchAtLogin {
		t.Fatal("expected launch-at-login preference to persist")
	}
	again := NewApp().GetSystemInfo()
	if !again.LaunchAtLogin {
		t.Fatal("launch-at-login not reloaded")
	}
}

func TestMaybeRecordDailyUpdateCheck(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_SETTINGS_DIR", t.TempDir())
	a := NewApp()
	if a.GetClientInfo().LastUpdateCheck != "" {
		t.Fatal("expected empty last check before watcher")
	}
	a.maybeRecordDailyUpdateCheck()
	first := a.GetClientInfo().LastUpdateCheck
	if first == "" {
		t.Fatal("expected daily check to record a timestamp")
	}
	a.maybeRecordDailyUpdateCheck()
	if a.GetClientInfo().LastUpdateCheck != first {
		t.Fatal("should not rewrite last check within 24h")
	}
}
