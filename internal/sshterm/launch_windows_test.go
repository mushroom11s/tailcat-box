//go:build windows

package sshterm

import (
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

func TestLaunchDetachesConsole(t *testing.T) {
	cmd := exec.Command("cmd.exe", "/c", "start")
	detachCommand(cmd)
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatalf("HideWindow not set: %+v", cmd.SysProcAttr)
	}
	want := uint32(windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW)
	if cmd.SysProcAttr.CreationFlags != want {
		t.Fatalf("CreationFlags=%#x want %#x", cmd.SysProcAttr.CreationFlags, want)
	}
}
