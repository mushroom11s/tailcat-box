//go:build darwin

package sysinfo

import (
	"os/exec"
	"strings"
)

func platformPrettyName() string {
	out, err := exec.Command("sw_vers", "-productVersion").Output()
	if err != nil {
		return "macOS"
	}
	ver := strings.TrimSpace(string(out))
	if ver == "" {
		return "macOS"
	}
	return "macOS " + ver
}
