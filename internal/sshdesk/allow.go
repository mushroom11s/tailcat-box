package sshdesk

import (
	"sort"
	"strings"
)

// AllowKeys returns the unique node keys that may open a shell.
// saved are keys from saved devices. rooms are keys from open chat rooms.
// The result is sorted so the serve configuration stays stable.
func AllowKeys(saved, rooms []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, key := range append(append([]string{}, saved...), rooms...) {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// RoomOnly returns room addresses that are not already saved as devices.
func RoomOnly(saved []Peer, rooms []string) []string {
	known := map[string]bool{}
	for _, p := range saved {
		known[strings.TrimSpace(p.Address)] = true
	}
	var out []string
	seen := map[string]bool{}
	for _, addr := range rooms {
		addr = strings.TrimSpace(addr)
		if addr == "" || known[addr] || seen[addr] {
			continue
		}
		seen[addr] = true
		out = append(out, addr)
	}
	sort.Strings(out)
	return out
}
