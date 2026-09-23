package update

import (
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/pkg/browser"
)

// RevealArgs is the OS command that shows path in the file manager.
func RevealArgs(goos, path string) (string, []string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", nil, errors.New("empty path")
	}
	switch goos {
	case "darwin":
		return "open", []string{"-R", path}, nil
	case "windows":
		return "explorer", []string{"/select," + path}, nil
	default:
		return "xdg-open", []string{filepath.Dir(path)}, nil
	}
}

// Reveal shows the downloaded zip in Finder or Explorer, or opens its folder.
func Reveal(path string) error {
	name, args, err := RevealArgs(runtime.GOOS, path)
	if err != nil {
		return err
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
		return browser.OpenFile(filepath.Dir(path))
	}
	return exec.Command(name, args...).Start()
}
