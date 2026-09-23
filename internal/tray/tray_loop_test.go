package tray

import (
	"os"
	"strings"
	"testing"
)

func TestTrayNativeDoesNotLaunchSystrayOffThread(t *testing.T) {
	src, err := os.ReadFile("tray_native.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(src), "\n") {
		code := strings.TrimSpace(line)
		if strings.HasPrefix(code, "//") {
			continue
		}
		if strings.Contains(code, "go start()") {
			t.Fatal("darwin nativeStart creates NSStatusItem on the caller; launch it with startLoop, not go start()")
		}
	}
}
