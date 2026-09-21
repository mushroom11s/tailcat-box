//go:build windows

package autostart

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

const (
	runKey        = `Software\Microsoft\Windows\CurrentVersion\Run`
	legacyAppName = "Tailcat"
)

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
	for _, name := range []string{appName, legacyAppName} {
		ok, err := runValueSet(k, name)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}

func runValueSet(k registry.Key, name string) (bool, error) {
	_, _, err := k.GetStringValue(name)
	if err == registry.ErrNotExist {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func deleteRunValue(k registry.Key, name string) error {
	err := k.DeleteValue(name)
	if err != nil && err != registry.ErrNotExist {
		return err
	}
	return nil
}

// SetEnabled adds or removes the HKCU Run value for this executable.
func SetEnabled(enabled bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !enabled {
		if err := deleteRunValue(k, appName); err != nil {
			return err
		}
		return deleteRunValue(k, legacyAppName)
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := k.SetStringValue(appName, `"`+exe+`"`); err != nil {
		return err
	}
	return deleteRunValue(k, legacyAppName)
}
