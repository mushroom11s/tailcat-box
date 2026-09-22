package sysinfo_test

import (
	"runtime"
	"strings"
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/sysinfo"
)

func TestOSVersionIncludesGOOSAndGOARCH(t *testing.T) {
	v := sysinfo.OSVersion()
	if v == "" {
		t.Fatal("empty OS version")
	}
	if !strings.Contains(v, runtime.GOOS) {
		t.Fatalf("OS version %q missing GOOS %s", v, runtime.GOOS)
	}
	if !strings.Contains(v, runtime.GOARCH) {
		t.Fatalf("OS version %q missing GOARCH %s", v, runtime.GOARCH)
	}
}

func TestNetworkReportsInterfacesOrOffline(t *testing.T) {
	n := sysinfo.Network()
	if n.Online && strings.TrimSpace(n.Summary) == "" {
		t.Fatal("online network must include an interface summary")
	}
	if !n.Online && n.Summary == "" {
		t.Fatal("offline network should still describe why")
	}
}
