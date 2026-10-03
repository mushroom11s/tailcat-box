//go:build windows

package sshterm

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// detachCommand keeps the GUI process off the console that cmd /c start
// creates. Closing that console delivers CTRL_CLOSE_EVENT, and Windows
// terminates every process attached to it. Go's handler cannot cancel
// CTRL_CLOSE_EVENT. The Tailcat SSH child still calls AllocConsole, so
// its window is a different console.
func detachCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW,
	}
}
