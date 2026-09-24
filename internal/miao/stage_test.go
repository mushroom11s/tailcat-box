package miao

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStageRejectsOversizeBeforeCopy(t *testing.T) {
	root := t.TempDir()
	big := filepath.Join(root, "big.bin")
	f, err := os.Create(big)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(MaxBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()

	dest := filepath.Join(root, "share")
	_, err = Stage(dest, []Source{{Name: "big.bin", Path: big}})
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err=%v", err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatalf("oversize share created a directory: %v", statErr)
	}
}

func TestStageRejectsCombinedSize(t *testing.T) {
	root := t.TempDir()
	var sources []Source
	for _, name := range []string{"a.bin", "b.bin"} {
		path := filepath.Join(root, name)
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.Truncate(MaxBytes/2 + 8); err != nil {
			t.Fatal(err)
		}
		f.Close()
		sources = append(sources, Source{Name: name, Path: path})
	}
	dest := filepath.Join(root, "share")
	if _, err := Stage(dest, sources); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err=%v", err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatal("combined oversize should not leave a share directory")
	}
}

func TestStageRenamesStorageAndCleanup(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "in")
	if err := os.Mkdir(srcDir, 0o700); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(srcDir, "notes.txt")
	if err := os.WriteFile(nested, []byte("hello miao"), 0o600); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(root, "share")
	pkg, err := Stage(dest, []Source{
		{Name: "subdir/notes.txt", Path: nested},
		{Name: "memo.txt", Data: []byte("second")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Total != int64(len("hello miao")+len("second")) {
		t.Fatalf("total=%d", pkg.Total)
	}
	if len(pkg.Files) != 2 || pkg.Files[0].Name != "notes.txt" || pkg.Files[1].Name != "memo.txt" {
		t.Fatalf("files=%+v", pkg.Files)
	}
	entries, err := os.ReadDir(dest)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries=%d", len(entries))
	}
	for _, entry := range entries {
		if entry.Name() == "notes.txt" || entry.Name() == "memo.txt" || strings.Contains(entry.Name(), "notes") {
			t.Fatalf("storage name kept the display name: %s", entry.Name())
		}
		if len(entry.Name()) != 32 {
			t.Fatalf("storage name=%s", entry.Name())
		}
	}
	body, err := os.ReadFile(pkg.Files[0].Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "hello miao" {
		t.Fatalf("body=%q", body)
	}
	if err := pkg.Remove(); err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatal("cleanup left the share directory")
	}
}
