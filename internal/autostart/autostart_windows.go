//go:build windows

package autostart

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

// Supported reports whether OS login-item registration is implemented.
func Supported() bool { return true }

// Enabled reports whether the HKCU Run value is set.
func Enabled() (bool, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return false, nil
		}
		return false, err
	}
	defer k.Close()
	_, _, err = k.GetStringValue(appName)
	if err == registry.ErrNotExist {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// SetEnabled adds or removes the HKCU Run value for this executable.
func SetEnabled(enabled bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !enabled {
		err := k.DeleteValue(appName)
		if err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return k.SetStringValue(appName, `"`+exe+`"`)
}
