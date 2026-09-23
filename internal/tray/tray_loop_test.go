package tray

import (
	"os"
	"strings"
	"testing"
)

func TestDarwinTrayStartsOnMainThread(t *testing.T) {
	code := nonCommentCode(t, "tray_start_darwin.go")
	if strings.Contains(code, "go start()") {
		t.Fatal("darwin nativeStart creates NSStatusItem on the caller; launch it with startLoop, not go start()")
	}
	if !strings.Contains(code, "RunWithExternalLoop") || !strings.Contains(code, "startLoop(start)") {
		t.Fatal("darwin must keep RunWithExternalLoop dispatched onto the AppKit main queue")
	}
	if strings.Contains(code, "systray.Run(") {
		t.Fatal("systray.Run owns the AppKit loop; darwin must keep the external loop")
	}
	if !strings.Contains(code, "skipTray(c)") {
		t.Fatal("TAILCAT_NO_TRAY must still skip the darwin tray")
	}

	shared := nonCommentCode(t, "tray_native.go")
	if strings.Contains(shared, "go start()") || strings.Contains(shared, "RunWithExternalLoop") || strings.Contains(shared, "systray.Run(") {
		t.Fatal("shared tray setup must not start the platform loop")
	}
	if strings.Contains(shared, "SetOnRClick") {
		t.Fatal("right-click should keep the platform default menu")
	}
	for _, needle := range []string{
		"SetOnClick",
		"labels.Open",
		"labels.Hide",
		"labels.Chat",
		"labels.Tunnel",
		"labels.Settings",
		"labels.Quit",
		"SessionCountLabel",
		"countItem.Disable()",
	} {
		if !strings.Contains(shared, needle) {
			t.Fatalf("tray menu missing %s", needle)
		}
	}
}

func TestWindowsTrayMessageLoopSharesOSThread(t *testing.T) {
	code := nonCommentCode(t, "tray_loop_windows.go")
	if strings.Contains(code, "RunWithExternalLoop") || strings.Contains(code, "go start()") {
		t.Fatal("windows must not split HWND creation and GetMessage across threads")
	}
	if !strings.Contains(code, "runtime.LockOSThread()") {
		t.Fatal("windows tray loop must LockOSThread so the goroutine cannot migrate")
	}
	if !strings.Contains(code, "systray.Run(") {
		t.Fatal("windows must use systray.Run so creation and GetMessage share the caller")
	}
	if !strings.Contains(code, "skipTray(c)") {
		t.Fatal("TAILCAT_NO_TRAY must still skip the windows tray")
	}
	if strings.Contains(code, "SetOnRClick") {
		t.Fatal("right-click should keep the default windows menu")
	}

	// LockOSThread and systray.Run must sit on the same goroutine, lock first.
	start := strings.Index(code, "go func()")
	if start < 0 {
		t.Fatal("systray.Run must run on a dedicated goroutine so Wails startup is not blocked")
	}
	rest := code[start:]
	lock := strings.Index(rest, "runtime.LockOSThread()")
	run := strings.Index(rest, "systray.Run(")
	if lock < 0 || run < 0 || lock > run {
		t.Fatal("LockOSThread must happen on the systray.Run goroutine before Run")
	}
	if strings.Contains(rest[lock:run], "go ") {
		t.Fatal("GetMessage must stay on the locked goroutine")
	}
}

func TestSkipTrayEnv(t *testing.T) {
	if !skipTray(nil) {
		t.Fatal("nil controller should skip the tray")
	}
	c := New(nil, nil, nil)
	t.Setenv("TAILCAT_NO_TRAY", "")
	if skipTray(c) {
		t.Fatal("empty TAILCAT_NO_TRAY should still start the tray")
	}
	t.Setenv("TAILCAT_NO_TRAY", "1")
	if !skipTray(c) {
		t.Fatal("TAILCAT_NO_TRAY should skip the tray")
	}
}

func nonCommentCode(t *testing.T, name string) string {
	t.Helper()
	src, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	for _, line := range strings.Split(string(src), "\n") {
		code := strings.TrimSpace(line)
		if strings.HasPrefix(code, "//") {
			continue
		}
		b.WriteString(code)
		b.WriteByte('\n')
	}
	return b.String()
}
