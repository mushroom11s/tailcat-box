package main

import (
	"os/exec"
	"strings"
	"testing"
)

func TestOnlyAdapterImportsTailcat(t *testing.T) {
	cmd := exec.Command("go", "list", "-f", "{{.ImportPath}} {{join .Imports \",\"}}", "./...")
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		pkg, imports, _ := strings.Cut(line, " ")
		if strings.Contains(pkg, "/internal/adapter") {
			continue
		}
		if strings.Contains(imports, "github.com/tailscale/tailcat") {
			t.Errorf("%s imports github.com/tailscale/tailcat", pkg)
		}
	}
}
