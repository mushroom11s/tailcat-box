package appinfo

import (
	"bufio"
	"bytes"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
)

// Version is the desktop client software version. Override at build time with:
//
//	-ldflags "-X github.com/mushroom11s/tailcat-desktop-client/internal/appinfo.Version=1.2.3"
var Version = "0.1.0-dev"

const tailcatModule = "github.com/tailscale/tailcat"

// ClientVersion returns the desktop client software version.
func ClientVersion() string {
	v := strings.TrimSpace(Version)
	if v == "" {
		return "unknown"
	}
	return v
}

// TailcatVersion reports the compiled github.com/tailscale/tailcat module version.
func TailcatVersion() string {
	return ModuleVersion(tailcatModule)
}

// ModuleVersion reports the compiled version of a Go module dependency.
// Build info is preferred (available when the app links the module); go.mod is
// the fallback so packages that do not import Tailcat still report the pin.
func ModuleVersion(path string) string {
	if v := fromBuildInfo(path); v != "" {
		return v
	}
	if v := fromGoMod(path); v != "" {
		return v
	}
	return "unknown"
}

func fromBuildInfo(path string) string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, d := range info.Deps {
		if d.Path == path && d.Version != "" {
			return d.Version
		}
	}
	if info.Main.Path == path && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return ""
}

func fromGoMod(path string) string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		body, err := os.ReadFile(filepath.Join(dir, "go.mod"))
		if err == nil {
			return ParseGoModRequire(body, path)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// ParseGoModRequire returns the version required for path, or empty if absent.
func ParseGoModRequire(mod []byte, path string) string {
	sc := bufio.NewScanner(bytes.NewReader(mod))
	inBlock := false
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if i := strings.Index(line, "//"); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		if line == "" {
			continue
		}
		if !inBlock {
			if line == "require (" {
				inBlock = true
				continue
			}
			if strings.HasPrefix(line, "require ") {
				fields := strings.Fields(line)
				if len(fields) >= 3 && fields[1] == path {
					return fields[2]
				}
			}
			continue
		}
		if line == ")" {
			inBlock = false
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == path {
			return fields[1]
		}
	}
	return ""
}
