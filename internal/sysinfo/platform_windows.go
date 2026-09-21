//go:build windows

package sysinfo

import (
	"fmt"

	"golang.org/x/sys/windows"
)

func platformPrettyName() string {
	info := windows.RtlGetVersion()
	if info == nil {
		return "Windows"
	}
	return fmt.Sprintf("Windows %d.%d.%d", info.MajorVersion, info.MinorVersion, info.BuildNumber)
}
