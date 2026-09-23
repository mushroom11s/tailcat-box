package main

import (
	"encoding/base64"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
	"github.com/wailsapp/wails/v2/pkg/menu"
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

	fwd, err := a.StartForward(addr, []adapter.PortMapping{{LocalPort: 18080, RemotePort: 8080}}, false)
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

func TestProductTitle(t *testing.T) {
	if got := productTitle("en"); got != "Tailcat Box" {
		t.Fatalf("en=%q", got)
	}
	if got := productTitle("zh-CN"); got != "猫砂盆" {
		t.Fatalf("zh-CN=%q", got)
	}
	if got := productTitle("zh"); got != "猫砂盆" {
		t.Fatalf("zh=%q", got)
	}
	if got := productTitle(""); got != "Tailcat Box" {
		t.Fatalf("empty=%q", got)
	}
}

func TestNativeWindowTitleStaysEnglish(t *testing.T) {
	if windowTitle != "Tailcat Box" {
		t.Fatalf("windowTitle=%q", windowTitle)
	}
	if productTitle("zh-CN") == windowTitle {
		t.Fatal("zh-CN tray name collapsed onto the fixed window title")
	}
}

func TestStartupMenuSkipsInWindowBar(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_KEYS_DIR", t.TempDir())
	t.Setenv("TAILCAT_SETTINGS_DIR", t.TempDir())
	a := NewApp()
	got := a.startupApplicationMenu()
	if usesSystemMenuBar() {
		if got == nil {
			t.Fatal("darwin should install the system menu bar")
		}
		return
	}
	if got != nil {
		t.Fatal("windows and linux must not install an in-window menu bar")
	}
	a.syncApplicationMenu(productTitle("zh-CN"))
}

func TestApplicationMenuLocalizesActions(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_KEYS_DIR", t.TempDir())
	t.Setenv("TAILCAT_SETTINGS_DIR", t.TempDir())
	a := NewApp()
	a.SetUILocale("zh-CN")
	if got := menuActionLabels(a.applicationMenu(productTitle("zh-CN"))); !reflect.DeepEqual(got, []string{"打开", "隐藏", "聊天", "穿透", "设置", "退出"}) {
		t.Fatalf("zh=%v", got)
	}
	a.SetUILocale("en")
	m := a.applicationMenu(productTitle("en"))
	if got := menuActionLabels(m); !reflect.DeepEqual(got, []string{"Open", "Hide", "Chat", "Tunnel", "Settings", "Quit"}) {
		t.Fatalf("en=%v", got)
	}
	clickMenu(m)
}

func menuActionLabels(m *menu.Menu) []string {
	if m == nil || len(m.Items) == 0 || m.Items[0].SubMenu == nil {
		return nil
	}
	var out []string
	for _, item := range m.Items[0].SubMenu.Items {
		if item.IsSeparator() {
			continue
		}
		out = append(out, item.Label)
	}
	return out
}

func clickMenu(m *menu.Menu) {
	if m == nil {
		return
	}
	for _, item := range m.Items {
		if item.Click != nil {
			item.Click(nil)
		}
		if item.SubMenu != nil {
			clickMenu(item.SubMenu)
		}
	}
}

func TestChooseConfigDir(t *testing.T) {
	next := filepath.Join("/cfg", "tailcat-box")
	legacy := filepath.Join("/cfg", "tailcat-desktop-client")
	none := func(string) bool { return false }
	if got := chooseConfigDir("/cfg", "tailcat-box", "tailcat-desktop-client", none); got != next {
		t.Fatalf("new install=%q", got)
	}
	legacyOnly := func(path string) bool { return path == legacy }
	if got := chooseConfigDir("/cfg", "tailcat-box", "tailcat-desktop-client", legacyOnly); got != legacy {
		t.Fatalf("legacy install=%q", got)
	}
	both := func(string) bool { return true }
	if got := chooseConfigDir("/cfg", "tailcat-box", "tailcat-desktop-client", both); got != next {
		t.Fatalf("both present=%q", got)
	}
}

func TestSetUILocaleWithoutWindow(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_KEYS_DIR", t.TempDir())
	t.Setenv("TAILCAT_SETTINGS_DIR", t.TempDir())
	a := NewApp()
	a.SetUILocale("zh-CN")
	a.SetUILocale("en")
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

func TestChatRoomEchoAndRestartKey(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	t.Setenv("TAILCAT_KEYS_DIR", t.TempDir())
	a := NewApp()
	if _, err := a.StartChatRoom(); err != nil {
		t.Fatal(err)
	}
	var addr string
	deadline := time.After(2 * time.Second)
	for addr == "" {
		for _, item := range a.ListSessions() {
			if item.Kind == session.KindChat && item.Status == session.StatusRunning {
				addr = item.Address
			}
		}
		select {
		case <-deadline:
			t.Fatalf("%+v", a.ListSessions())
		case <-time.After(10 * time.Millisecond):
		}
	}
	again, err := a.StartChatRoom()
	if err != nil || again.Address != addr {
		t.Fatalf("again=%+v err=%v", again, err)
	}
	if err := a.ConnectChatPeer("tc:fake-echo"); err != nil {
		t.Fatal(err)
	}
	if err := a.SendChatText("hi", false, 0); err != nil {
		t.Fatal(err)
	}
	deadline = time.After(2 * time.Second)
	for !chatHas(a, "in", "echo") {
		select {
		case <-deadline:
			t.Fatalf("%+v", a.chat.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if _, err := a.CreateKey("home", false, ""); err != nil {
		t.Fatal(err)
	}
	restarted, err := a.RestartChatRoom("home")
	if err != nil {
		t.Fatal(err)
	}
	deadline = time.After(2 * time.Second)
	var next string
	for next == "" {
		for _, item := range a.ListSessions() {
			if item.ID == restarted.ID && item.Status == session.StatusRunning {
				next = item.Address
			}
		}
		select {
		case <-deadline:
			t.Fatalf("%+v", a.ListSessions())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if next == addr || !strings.HasPrefix(next, "tc:fake-room-key-") {
		t.Fatalf("next=%s old=%s", next, addr)
	}
	if a.chat.Peer() != "" {
		t.Fatalf("peer=%s", a.chat.Peer())
	}
}

func TestChatVoiceWireFormatIsBase64(t *testing.T) {
	t.Setenv("TAILCAT_ADAPTER", "fake")
	a := NewApp()
	raw := []byte("RIFF0000WAVE")
	encoded := base64.StdEncoding.EncodeToString(raw)
	got, err := a.DecodeChatVoice("audio/wav", encoded)
	if err != nil {
		t.Fatal(err)
	}
	if got != encoded {
		t.Fatalf("decoded %q", got)
	}
	if _, err := a.DecodeChatVoice("audio/wav", "@@@"); err == nil {
		t.Fatal("expected invalid base64 to fail")
	}
	if err := a.SendChatVoice("audio/webm;codecs=opus", 1, encoded, false, 0); err == nil || !strings.Contains(err.Error(), "no peer") {
		t.Fatalf("send without a peer: %v", err)
	}
}

func chatHas(a *App, direction, body string) bool {
	for _, msg := range a.chat.Messages() {
		if msg.Direction == direction && msg.Body == body {
			return true
		}
	}
	return false
}
