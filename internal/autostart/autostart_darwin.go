//go:build darwin

package autostart

import (
	"os"
	"path/filepath"
)

// Supported reports whether OS login-item registration is implemented.
func Supported() bool { return true }

func agentPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist"), nil
}

// Enabled reports whether the LaunchAgent plist currently exists.
func Enabled() (bool, error) {
	path, err := agentPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// SetEnabled writes or removes the LaunchAgent plist.
func SetEnabled(enabled bool) error {
	path, err := agentPath()
	if err != nil {
		return err
	}
	if !enabled {
		err := os.Remove(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, LaunchAgentPlist(label, exe), 0o644)
}
