package appinfo_test

import (
	"strings"
	"testing"

	"github.com/mushroom11s/tailcat-desktop-client/internal/appinfo"
)

func TestClientVersionIsNonEmpty(t *testing.T) {
	v := appinfo.ClientVersion()
	if v == "" {
		t.Fatal("empty client version")
	}
}

func TestTailcatModuleVersionFromGoModOrBuildInfo(t *testing.T) {
	v := appinfo.ModuleVersion("github.com/tailscale/tailcat")
	if v == "" || v == "unknown" {
		t.Fatalf("version=%q", v)
	}
	if !strings.HasPrefix(v, "v") && !strings.Contains(v, "-") {
		t.Fatalf("unexpected version %q", v)
	}
}

func TestParseGoModRequire(t *testing.T) {
	mod := []byte(`module example.com/app

go 1.22

require (
	github.com/tailscale/tailcat v0.7.0
	github.com/wailsapp/wails/v2 v2.16.0
)
`)
	if got := appinfo.ParseGoModRequire(mod, "github.com/tailscale/tailcat"); got != "v0.7.0" {
		t.Fatalf("got %q", got)
	}
	if got := appinfo.ParseGoModRequire(mod, "missing"); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestModuleVersionUnknown(t *testing.T) {
	if got := appinfo.ModuleVersion("example.com/not-a-real-module"); got != "unknown" {
		t.Fatalf("got %q", got)
	}
}
