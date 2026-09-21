//go:build !darwin && !windows

package autostart

import "fmt"

// Supported reports whether OS login-item registration is implemented.
func Supported() bool { return false }

// Enabled is always false on platforms without a login-item helper.
func Enabled() (bool, error) { return false, nil }

// SetEnabled returns an error: launch-at-login is macOS/Windows only.
func SetEnabled(enabled bool) error {
	_ = enabled
	return fmt.Errorf("launch at login is not implemented on this OS")
}
