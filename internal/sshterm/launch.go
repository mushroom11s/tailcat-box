package sshterm

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Launch opens a system terminal attached to the bridge at addr.
func Launch(addr, token string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	bin, args, err := terminalArgs(runtime.GOOS, exe, addr, token, exec.LookPath)
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, args...)
	return cmd.Start()
}

func terminalArgs(goos, exe, addr, token string, look func(string) (string, error)) (string, []string, error) {
	switch goos {
	case "windows":
		// start treats a quoted first argument as the window title.
		return "cmd.exe", []string{"/c", "start", "Tailcat SSH", exe, AttachArg, addr, token}, nil
	case "darwin":
		script := fmt.Sprintf(
			"tell application \"Terminal\" to do script \"exec %s %s %s %s\"",
			shellQuote(exe), AttachArg, shellQuote(addr), shellQuote(token),
		)
		return "osascript", []string{"-e", script}, nil
	default:
		for _, name := range []string{"x-terminal-emulator", "gnome-terminal", "konsole", "xterm"} {
			path, err := look(name)
			if err != nil {
				continue
			}
			if name == "gnome-terminal" {
				return path, []string{"--", exe, AttachArg, addr, token}, nil
			}
			return path, []string{"-e", exe, AttachArg, addr, token}, nil
		}
		return "", nil, fmt.Errorf("no system terminal found")
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
