package sysinfo

import (
	"bufio"
	"os"
	"runtime"
	"strings"
)

// OSVersion returns a human-readable OS / architecture string.
func OSVersion() string {
	pretty := platformPrettyName()
	if pretty == "" {
		pretty = runtime.GOOS
	}
	return pretty + " (" + runtime.GOOS + "/" + runtime.GOARCH + ")"
}

type NetworkStatus struct {
	Online  bool
	Summary string
}

// Network lists non-loopback interfaces that are up and have an address.
// It does not probe the public internet, so a machine with only a LAN
// interface still reports online.
func Network() NetworkStatus {
	ifaces, err := listUpInterfaces()
	if err != nil {
		return NetworkStatus{Online: false, Summary: err.Error()}
	}
	if len(ifaces) == 0 {
		return NetworkStatus{Online: false, Summary: "no non-loopback interfaces"}
	}
	return NetworkStatus{Online: true, Summary: strings.Join(ifaces, ", ")}
}

func readOSReleasePrettyName() string {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		key, val, ok := strings.Cut(line, "=")
		if !ok || key != "PRETTY_NAME" {
			continue
		}
		return strings.Trim(val, `"`)
	}
	return ""
}
