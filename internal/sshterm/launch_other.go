//go:build !windows

package sshterm

import "os/exec"

func detachCommand(cmd *exec.Cmd) {}
