package chat

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCleanFileNameDropsDirectories(t *testing.T) {
	name, err := cleanFileName(`..\secret\report.pdf`)
	if err != nil || name != "report.pdf" {
		t.Fatalf("name=%q err=%v", name, err)
	}
	name, err = cleanFileName("folder/photo.png")
	if err != nil || name != "photo.png" {
		t.Fatalf("name=%q err=%v", name, err)
	}
	if _, err := cleanFileName(""); err == nil {
		t.Fatal("expected empty name")
	}
	if _, err := cleanFileName(".."); err == nil {
		t.Fatal("expected dotdot rejection")
	}
	if _, err := cleanFileName("folder/.."); err == nil {
		t.Fatal("expected traversal rejection")
	}
}

func TestPrefixGrowthOverlapAndGap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "partial")
	got, ok, err := applyPrefix(path, 0, []byte("hello"))
	if err != nil || !ok || got != 5 {
		t.Fatalf("got=%d ok=%v err=%v", got, ok, err)
	}
	got, ok, err = applyPrefix(path, 3, []byte("lo!!"))
	if err != nil || !ok || got != 7 {
		t.Fatalf("overlap got=%d ok=%v err=%v", got, ok, err)
	}
	body, err := os.ReadFile(path)
	if err != nil || string(body) != "hello!!" {
		t.Fatalf("body=%q err=%v", body, err)
	}
	got, ok, err = applyPrefix(path, 100, []byte("x"))
	if err != nil || ok || got != 7 {
		t.Fatalf("gap got=%d ok=%v err=%v", got, ok, err)
	}
	body, _ = os.ReadFile(path)
	if string(body) != "hello!!" {
		t.Fatalf("gap mutated %q", body)
	}
}

func TestHashMatchAndMismatchDeletesPartial(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "partial")
	payload := []byte("abc")
	if _, _, err := applyPrefix(path, 0, payload); err != nil {
		t.Fatal(err)
	}
	sum, _, err := hashFile(path)
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	again, err := hashReader(f)
	f.Close()
	if err != nil || again != sum {
		t.Fatalf("again=%s sum=%s err=%v", again, sum, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("partial still present")
	}
}

func TestHashFileStreams(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "blob.bin")
	body := []byte("tailcat-file")
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
	sum, n, err := hashFile(path)
	if err != nil || n != int64(len(body)) || len(sum) != 64 {
		t.Fatalf("sum=%s n=%d err=%v", sum, n, err)
	}
}

func TestLaunchSweepAndStop(t *testing.T) {
	dir := t.TempDir()
	inbox := filepath.Join(dir, inboxDirName)
	partial := filepath.Join(dir, partialDirName)
	if err := os.MkdirAll(inbox, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(partial, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inbox, "old"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(partial, "old"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := New(nil)
	svc.SetDataDir(dir)
	if n := dirCount(t, inbox); n != 0 {
		t.Fatalf("inbox entries=%d", n)
	}
	if n := dirCount(t, partial); n != 0 {
		t.Fatalf("partial entries=%d", n)
	}
	if err := os.WriteFile(filepath.Join(inbox, "keep-until-next-launch"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(partial, "drop-on-quit"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if n := dirCount(t, partial); n != 0 {
		t.Fatalf("partial after stop=%d", n)
	}
	if n := dirCount(t, inbox); n != 1 {
		t.Fatalf("inbox after stop=%d", n)
	}
	next := New(nil)
	next.SetDataDir(dir)
	if n := dirCount(t, inbox); n != 0 {
		t.Fatalf("inbox after relaunch=%d", n)
	}
}

func dirCount(t *testing.T, dir string) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return len(entries)
}
