package autostart_test

import (
	"runtime"
	"strings"
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/autostart"
)

func TestLaunchAgentPlistContainsLabelAndExe(t *testing.T) {
	body := autostart.LaunchAgentPlist("com.mushroom11s.tailcat-desktop-client", "/tmp/tailcat-desktop-client")
	text := string(body)
	if !strings.Contains(text, "com.mushroom11s.tailcat-desktop-client") {
		t.Fatal(text)
	}
	if !strings.Contains(text, "/tmp/tailcat-desktop-client") {
		t.Fatal(text)
	}
	if !strings.Contains(text, "RunAtLoad") {
		t.Fatal(text)
	}
}

func TestSupportedMatchesProductPlatforms(t *testing.T) {
	want := runtime.GOOS == "darwin" || runtime.GOOS == "windows"
	if got := autostart.Supported(); got != want {
		t.Fatalf("Supported()=%v want %v on %s", got, want, runtime.GOOS)
	}
}

func TestStubSetEnabledDoesNotPanic(t *testing.T) {
	if autostart.Supported() {
		t.Skip("OS login-item helpers are wired on this platform")
	}
	if err := autostart.SetEnabled(true); err == nil {
		t.Fatal("expected unsupported error")
	}
	enabled, err := autostart.Enabled()
	if err != nil {
		t.Fatal(err)
	}
	if enabled {
		t.Fatal("stub should report not enabled")
	}
}
