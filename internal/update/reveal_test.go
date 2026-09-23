package update

import (
	"path/filepath"
	"testing"
)

func TestRevealArgs(t *testing.T) {
	t.Parallel()
	path := filepath.Join("Downloads", "tailcat-box-macos-arm64-v0.1.0.zip")
	name, args, err := RevealArgs("darwin", path)
	if err != nil {
		t.Fatal(err)
	}
	if name != "open" || len(args) != 2 || args[0] != "-R" || args[1] != path {
		t.Fatalf("darwin reveal = %s %v", name, args)
	}
	win := filepath.Join("Downloads", "tailcat-box-windows-amd64-v0.1.0.zip")
	name, args, err = RevealArgs("windows", win)
	if err != nil {
		t.Fatal(err)
	}
	if name != "explorer" || len(args) != 1 || args[0] != "/select,"+win {
		t.Fatalf("windows reveal = %s %v", name, args)
	}
	name, args, err = RevealArgs("linux", path)
	if err != nil {
		t.Fatal(err)
	}
	if name != "xdg-open" || len(args) != 1 || args[0] != filepath.Dir(path) {
		t.Fatalf("linux reveal = %s %v", name, args)
	}
	if _, _, err := RevealArgs("darwin", "  "); err == nil {
		t.Fatal("expected empty path to fail")
	}
}
