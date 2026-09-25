package miao

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setCopyLimit(t *testing.T, n int64) {
	t.Helper()
	prev := copyLimit
	copyLimit = n
	t.Cleanup(func() { copyLimit = prev })
}

func TestMaxBytesIsTheCopyCeiling(t *testing.T) {
	if MaxBytes != 300<<20 {
		t.Fatalf("MaxBytes=%d", MaxBytes)
	}
	if copyLimit != MaxBytes {
		t.Fatalf("copyLimit=%d", copyLimit)
	}
}

func TestStageByRefKeepsOriginal(t *testing.T) {
	setCopyLimit(t, 8)
	root := t.TempDir()
	srcDir := filepath.Join(root, "secret-origin")
	if err := os.Mkdir(srcDir, 0o700); err != nil {
		t.Fatal(err)
	}
	big := filepath.Join(srcDir, "big.bin")
	body := []byte("0123456789")
	if err := os.WriteFile(big, body, 0o600); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(root, "share")
	pkg, err := Stage(dest, []Source{{Name: "big.bin", Path: big}})
	if err != nil {
		t.Fatal(err)
	}
	if !pkg.ByRef || pkg.Total != int64(len(body)) || len(pkg.Files) != 1 {
		t.Fatalf("pkg=%+v", pkg)
	}
	file := pkg.Files[0]
	abs, err := filepath.Abs(big)
	if err != nil {
		t.Fatal(err)
	}
	if file.Path != abs || file.OriginPath != abs || file.Name != "big.bin" {
		t.Fatalf("file=%+v", file)
	}
	if file.StorageName == "big.bin" || len(file.StorageName) != 32 {
		t.Fatalf("storage=%s", file.StorageName)
	}
	sum := sha256.Sum256(body)
	if file.SHA256 != hex.EncodeToString(sum[:]) || file.Size != int64(len(body)) {
		t.Fatalf("file=%+v", file)
	}
	entries, err := os.ReadDir(dest)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("by-ref share copied files: %v", names(entries))
	}
	if err := pkg.Remove(); err != nil {
		t.Fatal(err)
	}
	kept, err := os.ReadFile(big)
	if err != nil || string(kept) != string(body) {
		t.Fatalf("original changed: %q %v", kept, err)
	}
}

func TestStageByRefUsesOneModeForThePack(t *testing.T) {
	setCopyLimit(t, 8)
	root := t.TempDir()
	var sources []Source
	for _, name := range []string{"a.bin", "b.bin"} {
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, []byte("12345"), 0o600); err != nil {
			t.Fatal(err)
		}
		sources = append(sources, Source{Name: name, Path: path})
	}
	dest := filepath.Join(root, "share")
	pkg, err := Stage(dest, sources)
	if err != nil {
		t.Fatal(err)
	}
	if !pkg.ByRef || len(pkg.Files) != 2 || pkg.Total != 10 {
		t.Fatalf("pkg=%+v", pkg)
	}
	for i, file := range pkg.Files {
		if file.OriginPath == "" || file.Path != file.OriginPath {
			t.Fatalf("file=%+v", file)
		}
		if _, err := os.Stat(filepath.Join(dest, file.StorageName)); !os.IsNotExist(err) {
			t.Fatalf("copied %s: %v", sources[i].Name, err)
		}
	}
}

func TestStageRejectsOversizedBytesWithoutAPath(t *testing.T) {
	setCopyLimit(t, 8)
	root := t.TempDir()
	dest := filepath.Join(root, "share")
	_, err := Stage(dest, []Source{{Name: "mem.bin", Data: []byte("0123456789")}})
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err=%v", err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatalf("oversize bytes created a directory: %v", statErr)
	}
}

func TestStageRejectsMixedOversizedPack(t *testing.T) {
	setCopyLimit(t, 8)
	root := t.TempDir()
	big := filepath.Join(root, "big.bin")
	if err := os.WriteFile(big, []byte("0123456789"), 0o600); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(root, "share")
	_, err := Stage(dest, []Source{
		{Name: "big.bin", Path: big},
		{Name: "note.txt", Data: []byte("x")},
	})
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err=%v", err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatal("mixed oversize should not leave a share directory")
	}
	if _, err := os.Stat(big); err != nil {
		t.Fatal(err)
	}
}

func TestStageRejectsFolder(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "folder")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	_, err := Stage(filepath.Join(root, "share"), []Source{{Name: "folder", Path: dir}})
	if !errors.Is(err, ErrFolder) {
		t.Fatalf("err=%v", err)
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
	if pkg.ByRef || pkg.Total != int64(len("hello miao")+len("second")) {
		t.Fatalf("total=%d byRef=%v", pkg.Total, pkg.ByRef)
	}
	if len(pkg.Files) != 2 || pkg.Files[0].Name != "notes.txt" || pkg.Files[1].Name != "memo.txt" {
		t.Fatalf("files=%+v", pkg.Files)
	}
	if pkg.Files[0].OriginPath != "" || pkg.Files[1].OriginPath != "" {
		t.Fatalf("copied share recorded origins: %+v", pkg.Files)
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
	kept, err := os.ReadFile(nested)
	if err != nil || string(kept) != "hello miao" {
		t.Fatalf("source changed: %q %v", kept, err)
	}
}

func TestCheckOriginRejectsMoveSizeAndHash(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "note.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	checked, err := checkOrigin(path, 5, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := checkOrigin(checked.OriginPath, checked.Size, checked.SHA256); err != nil {
		t.Fatal(err)
	}
	moved := filepath.Join(root, "other.txt")
	if err := os.Rename(path, moved); err != nil {
		t.Fatal(err)
	}
	if _, err := checkOrigin(checked.OriginPath, checked.Size, checked.SHA256); !errors.Is(err, ErrOriginGone) {
		t.Fatalf("moved err=%v", err)
	}
	if err := os.Rename(moved, path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("hello!"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := checkOrigin(checked.OriginPath, checked.Size, checked.SHA256); !errors.Is(err, ErrOriginGone) {
		t.Fatalf("size err=%v", err)
	}
	if err := os.WriteFile(path, []byte("HELLO"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := checkOrigin(checked.OriginPath, 5, checked.SHA256); !errors.Is(err, ErrOriginGone) {
		t.Fatalf("hash err=%v", err)
	}
}
