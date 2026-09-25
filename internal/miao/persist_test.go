package miao

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
)

func TestShareRestoredAfterRestart(t *testing.T) {
	root := t.TempDir()
	first := New(adapter.NewFake(), root)
	snap, err := first.Start([]Source{{Name: "笔记.txt", Data: []byte("purr")}}, Limits{TTL: 48 * time.Hour, TTLDays: 2, MaxDownloads: 3}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if snap.CreatedAt == "" || snap.Payload == "" || snap.Token == "" {
		t.Fatalf("snap=%+v", snap)
	}
	statePath := filepath.Join(root, snap.ID, "share.json")
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("share state mode=%o", info.Mode().Perm())
	}
	raw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	key, _ := saved["key"].(string)
	if key == "" {
		t.Fatal("share state has no room key")
	}
	published, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(published), key) {
		t.Fatal("room key leaked into the share snapshot")
	}
	created, _ := saved["createdAt"].(string)
	if created == "" {
		t.Fatal("share state has no createdAt")
	}

	dest := t.TempDir()
	if _, err := first.Join(context.Background(), snap.Payload, dest, adapter.NetworkOpts{}); err != nil {
		t.Fatal(err)
	}
	if listed := first.List(); len(listed) != 1 || listed[0].Downloads != 1 {
		t.Fatalf("after download=%+v", listed)
	}
	first.Close()
	if _, err := os.Stat(filepath.Join(root, snap.ID)); err != nil {
		t.Fatalf("quit removed the share: %v", err)
	}

	again := New(adapter.NewFake(), root)
	listed := again.List()
	if len(listed) != 1 {
		t.Fatalf("restored=%d %+v", len(listed), listed)
	}
	got := listed[0]
	if got.ID != snap.ID || got.Payload != snap.Payload || got.Token != snap.Token || got.Address != snap.Address {
		t.Fatalf("restored=%+v want id/payload/token/address from %+v", got, snap)
	}
	if got.Downloads != 1 || got.MaxDownloads != 3 || got.TTLDays != 2 || got.Forever || got.ExpiresAt != snap.ExpiresAt || got.CreatedAt != snap.CreatedAt {
		t.Fatalf("limits=%+v want downloads=1 ttlDays=2 expires=%s created=%s", got, snap.ExpiresAt, snap.CreatedAt)
	}
	if len(got.Files) != 1 || got.Files[0].Name != "笔记.txt" {
		t.Fatalf("files=%+v", got.Files)
	}
	againRaw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var kept map[string]any
	if err := json.Unmarshal(againRaw, &kept); err != nil {
		t.Fatal(err)
	}
	if kept["createdAt"] != created || kept["key"] != key {
		t.Fatalf("state changed across restart: %+v", kept)
	}

	second := t.TempDir()
	receipt, err := again.Join(context.Background(), snap.Payload, second, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(receipt.Files[0].Path)
	if err != nil || string(body) != "purr" || receipt.Files[0].Name != "笔记.txt" {
		t.Fatalf("body=%q receipt=%+v err=%v", body, receipt.Files, err)
	}
	if listed = again.List(); len(listed) != 1 || listed[0].Downloads != 2 || listed[0].Payload != snap.Payload {
		t.Fatalf("after second download=%+v", listed)
	}
}

func TestRestartDropsExpiredAndExhaustedShares(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	expired, err := svc.Start([]Source{{Name: "old.txt", Data: []byte("old")}}, Limits{TTL: time.Hour, TTLDays: 1, MaxDownloads: 2}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	exhausted, err := svc.Start([]Source{{Name: "done.txt", Data: []byte("done")}}, Limits{MaxDownloads: 2}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	kept, err := svc.Start([]Source{{Name: "live.txt", Data: []byte("live")}}, Limits{TTL: 24 * time.Hour, TTLDays: 1}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	svc.Close()

	rewriteShareState(t, filepath.Join(root, expired.ID, "share.json"), func(rec map[string]any) {
		rec["forever"] = false
		rec["expiresAt"] = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	})
	rewriteShareState(t, filepath.Join(root, exhausted.ID, "share.json"), func(rec map[string]any) {
		rec["downloads"] = rec["maxDownloads"]
	})

	again := New(adapter.NewFake(), root)
	listed := again.List()
	if len(listed) != 1 || listed[0].ID != kept.ID || listed[0].Payload != kept.Payload {
		t.Fatalf("listed=%+v", listed)
	}
	if notes := again.RestoreNotes(); len(notes) != 0 {
		t.Fatalf("quiet drop reported notes=%v", notes)
	}
	if _, err := os.Stat(filepath.Join(root, expired.ID)); !os.IsNotExist(err) {
		t.Fatalf("expired share remains: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, exhausted.ID)); !os.IsNotExist(err) {
		t.Fatalf("exhausted share remains: %v", err)
	}
}

func TestRestartReportsMissingShareFile(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	snap, err := svc.Start([]Source{{Name: "gone.txt", Data: []byte("gone")}, {Name: "stay.txt", Data: []byte("stay")}}, Limits{MaxDownloads: 4}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	svc.Close()
	dir := filepath.Join(root, snap.ID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	removed := false
	for _, entry := range entries {
		if entry.Name() == "share.json" {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
			t.Fatal(err)
		}
		removed = true
		break
	}
	if !removed {
		t.Fatal("no staged file to remove")
	}

	again := New(adapter.NewFake(), root)
	if len(again.List()) != 0 {
		t.Fatalf("missing file still shared: %+v", again.List())
	}
	notes := again.RestoreNotes()
	if len(notes) != 1 || notes[0] != ErrShareMissing.Error() {
		t.Fatalf("notes=%v", notes)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("broken share kept: %v", err)
	}
	quiet := New(adapter.NewFake(), root)
	if len(quiet.List()) != 0 || len(quiet.RestoreNotes()) != 0 {
		t.Fatalf("second launch listed=%+v notes=%v", quiet.List(), quiet.RestoreNotes())
	}
}

func TestEndedShareIsNotRestored(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	snap, err := svc.Start([]Source{{Name: "end.txt", Data: []byte("end")}}, Limits{}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.End(snap.ID); err != nil {
		t.Fatal(err)
	}
	waitEmpty(t, root)
	svc.Close()
	again := New(adapter.NewFake(), root)
	if len(again.List()) != 0 {
		t.Fatalf("ended share returned: %+v", again.List())
	}
}

type denyRooms struct {
	adapter.ChatAdapter
}

func (denyRooms) StartRoom(context.Context, adapter.RoomOpts) (adapter.Room, error) {
	return nil, fmt.Errorf("room down")
}

func TestShareRecordStaysListedWhenListenFails(t *testing.T) {
	root := t.TempDir()
	first := New(adapter.NewFake(), root)
	snap, err := first.Start([]Source{{Name: "笔记.txt", Data: []byte("purr")}}, Limits{TTL: 48 * time.Hour, TTLDays: 2, MaxDownloads: 3}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	if _, err := first.Join(context.Background(), snap.Payload, dest, adapter.NetworkOpts{}); err != nil {
		t.Fatal(err)
	}
	first.Close()

	again := New(denyRooms{ChatAdapter: adapter.NewFake()}, root)
	t.Cleanup(again.Close)
	listed := again.List()
	if len(listed) != 1 {
		t.Fatalf("restored=%d notes=%v", len(listed), again.RestoreNotes())
	}
	got := listed[0]
	if got.ID != snap.ID || got.Payload != snap.Payload || got.Token != snap.Token || got.Status != "active" {
		t.Fatalf("record=%+v want id/payload/token from %+v", got, snap)
	}
	if got.Listening {
		t.Fatal("a share that failed to listen is marked online")
	}
	if got.Downloads != 1 || got.MaxDownloads != 3 {
		t.Fatalf("downloads=%d/%d", got.Downloads, got.MaxDownloads)
	}
	if len(got.Files) != 1 || got.Files[0].Name != "笔记.txt" {
		t.Fatalf("files=%+v", got.Files)
	}
	if notes := again.RestoreNotes(); len(notes) != 0 {
		t.Fatalf("listed record reported as unrestored: %v", notes)
	}
	if _, err := os.Stat(filepath.Join(root, snap.ID, "share.json")); err != nil {
		t.Fatalf("share record removed: %v", err)
	}
}

type failOnceRooms struct {
	adapter.ChatAdapter
	mu sync.Mutex
	n  int
}

func (f *failOnceRooms) StartRoom(ctx context.Context, opts adapter.RoomOpts) (adapter.Room, error) {
	f.mu.Lock()
	f.n++
	n := f.n
	f.mu.Unlock()
	if n == 1 {
		return nil, fmt.Errorf("room down")
	}
	return f.ChatAdapter.StartRoom(ctx, opts)
}

func TestShareListensAgainAfterAFailedRestore(t *testing.T) {
	root := t.TempDir()
	first := New(adapter.NewFake(), root)
	snap, err := first.Start([]Source{{Name: "笔记.txt", Data: []byte("purr")}}, Limits{MaxDownloads: 3}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	first.Close()

	again := New(&failOnceRooms{ChatAdapter: adapter.NewFake()}, root)
	t.Cleanup(again.Close)
	if listed := again.List(); len(listed) != 1 || listed[0].Payload != snap.Payload {
		t.Fatalf("listed=%+v", listed)
	}
	deadline := time.Now().Add(5 * time.Second)
	var joined error
	for {
		_, joined = again.Join(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{})
		if joined == nil || time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if joined != nil {
		t.Fatal(joined)
	}
	if listed := again.List(); len(listed) != 1 || listed[0].Downloads != 1 || listed[0].Payload != snap.Payload || !listed[0].Listening {
		t.Fatalf("after download=%+v", listed)
	}
}

func TestNewDropsUntrackedShareDir(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "orphan"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "orphan", "blob"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	incoming := filepath.Join(root, incomingDirName)
	if err := os.MkdirAll(incoming, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(incoming, "keep.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = New(adapter.NewFake(), root)
	if _, err := os.Stat(filepath.Join(root, "orphan")); !os.IsNotExist(err) {
		t.Fatalf("orphan remains: %v", err)
	}
	if _, err := os.Stat(filepath.Join(incoming, "keep.json")); err != nil {
		t.Fatal(err)
	}
}

func TestByRefShareRestoredAfterRestart(t *testing.T) {
	setCopyLimit(t, 4)
	root := t.TempDir()
	src := filepath.Join(t.TempDir(), "笔记.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	first := New(adapter.NewFake(), root)
	snap, err := first.Start([]Source{{Name: "笔记.txt", Path: src}}, Limits{TTL: 48 * time.Hour, TTLDays: 2, MaxDownloads: 3}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if !snap.ByRef {
		t.Fatal("expected a by-reference share")
	}
	first.Close()

	again := New(adapter.NewFake(), root)
	t.Cleanup(again.Close)
	listed := again.List()
	if len(listed) != 1 || listed[0].ID != snap.ID || !listed[0].ByRef || listed[0].Payload != snap.Payload {
		t.Fatalf("restored=%+v", listed)
	}
	receipt, err := again.Join(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(receipt.Files[0].Path)
	if err != nil || string(body) != "hello" || receipt.Files[0].Name != "笔记.txt" {
		t.Fatalf("body=%q receipt=%+v err=%v", body, receipt.Files, err)
	}
}

func TestByRefRestartReportsMovedFile(t *testing.T) {
	setCopyLimit(t, 4)
	root := t.TempDir()
	src := filepath.Join(t.TempDir(), "gone.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	first := New(adapter.NewFake(), root)
	snap, err := first.Start([]Source{{Name: "gone.txt", Path: src}}, Limits{MaxDownloads: 2}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	first.Close()
	moved := src + ".moved"
	if err := os.Rename(src, moved); err != nil {
		t.Fatal(err)
	}

	again := New(adapter.NewFake(), root)
	if len(again.List()) != 0 {
		t.Fatalf("moved file still shared: %+v", again.List())
	}
	notes := again.RestoreNotes()
	if len(notes) != 1 || notes[0] != ErrOriginGone.Error() {
		t.Fatalf("notes=%v", notes)
	}
	if _, err := os.Stat(moved); err != nil {
		t.Fatalf("restart removed the original: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, snap.ID)); !os.IsNotExist(err) {
		t.Fatalf("broken by-ref share kept: %v", err)
	}
}

func rewriteShareState(t *testing.T, path string, mutate func(map[string]any)) {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var rec map[string]any
	if err := json.Unmarshal(body, &rec); err != nil {
		t.Fatal(err)
	}
	mutate(rec)
	next, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, next, 0o600); err != nil {
		t.Fatal(err)
	}
}
