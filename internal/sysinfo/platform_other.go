//go:build !darwin && !windows

package sysinfo

func platformPrettyName() string {
	if name := readOSReleasePrettyName(); name != "" {
		return name
	}
	return ""
}
