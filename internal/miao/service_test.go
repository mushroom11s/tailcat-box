package miao

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
)

func TestShareDownloadThenCleanup(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	ctx := context.Background()
	snap, err := svc.Start([]Source{{Name: "笔记.txt", Data: []byte("purr")}}, Limits{MaxDownloads: 1}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseJoin(snap.Payload)
	if err != nil || !strings.HasPrefix(snap.Payload, "mw1.") || parsed.Addr != snap.Address || parsed.Token != snap.Token {
		t.Fatalf("snap=%+v parsed=%+v err=%v", snap, parsed, err)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 1 {
		t.Fatalf("staged entries=%v err=%v", entries, err)
	}
	staged, err := os.ReadDir(filepath.Join(root, entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	if len(staged) != 1 || staged[0].Name() == "笔记.txt" {
		t.Fatalf("storage names=%v", names(staged))
	}

	dest := t.TempDir()
	receipt, err := svc.Join(ctx, snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(receipt.Files) != 1 || receipt.Files[0].Name != "笔记.txt" {
		t.Fatalf("receipt=%+v", receipt.Files)
	}
	body, err := os.ReadFile(receipt.Files[0].Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "purr" {
		t.Fatalf("body=%q", body)
	}
	waitEmpty(t, root)
	if len(svc.List()) != 0 {
		t.Fatalf("still active: %+v", svc.List())
	}

	again, err := svc.Join(ctx, snap.Payload, t.TempDir(), adapter.NetworkOpts{})
	if err == nil {
		t.Fatalf("second download succeeded: %+v", again)
	}
	if !errors.Is(err, ErrUnreachable) && !errors.Is(err, ErrEnded) {
		t.Fatalf("second err=%v", err)
	}
}

func TestBadTokenKeepsFiles(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	snap, err := svc.Start([]Source{{Name: "a.txt", Data: []byte("a")}}, Limits{MaxDownloads: 2}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	bad, err := EncodeJoin(snap.Address, "not-the-token")
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.Join(context.Background(), bad, t.TempDir(), adapter.NetworkOpts{})
	if !errors.Is(err, ErrBadCode) {
		t.Fatalf("err=%v", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 1 {
		t.Fatalf("share removed after bad token: %v %v", entries, err)
	}
	if err := svc.End(snap.ID); err != nil {
		t.Fatal(err)
	}
	waitEmpty(t, root)
}

func TestTTLEndDeletesCopies(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	if _, err := svc.Start([]Source{{Name: "a.txt", Data: []byte("a")}}, Limits{TTL: 40 * time.Millisecond}, adapter.NetworkOpts{}); err != nil {
		t.Fatal(err)
	}
	waitEmpty(t, root)
	if len(svc.List()) != 0 {
		t.Fatalf("still active: %+v", svc.List())
	}
}

func TestConcurrentSharesStayIndependent(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	first, err := svc.Start([]Source{{Name: "one.txt", Data: []byte("one")}}, Limits{MaxDownloads: 1}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Start([]Source{{Name: "two.txt", Data: []byte("two")}}, Limits{TTL: time.Hour, TTLDays: 1, MaxDownloads: 3}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID || first.Token == second.Token || first.Payload == second.Payload {
		t.Fatalf("shares were not distinct: %+v %+v", first, second)
	}
	if len(svc.List()) != 2 {
		t.Fatalf("list=%d", len(svc.List()))
	}
	if _, err := os.Stat(filepath.Join(root, first.ID)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, second.ID)); err != nil {
		t.Fatal(err)
	}

	receipt, err := svc.Join(context.Background(), first.Payload, t.TempDir(), adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(receipt.Files) != 1 || receipt.Files[0].Name != "one.txt" {
		t.Fatalf("receipt=%+v", receipt.Files)
	}
	body, err := os.ReadFile(receipt.Files[0].Path)
	if err != nil || string(body) != "one" {
		t.Fatalf("body=%q err=%v", body, err)
	}
	if _, err := os.Stat(filepath.Join(root, first.ID)); !os.IsNotExist(err) {
		t.Fatalf("ended share still on disk: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, second.ID)); err != nil {
		t.Fatal(err)
	}
	listed := svc.List()
	if len(listed) != 1 || listed[0].ID != second.ID {
		t.Fatalf("list=%+v", listed)
	}

	if err := svc.End(second.ID); err != nil {
		t.Fatal(err)
	}
	waitEmpty(t, root)
	if len(svc.List()) != 0 {
		t.Fatalf("still active: %+v", svc.List())
	}
}

func TestParseJoinRejectsAddressOnly(t *testing.T) {
	if _, err := ParseJoin("tc:fake-room"); !errors.Is(err, ErrBadCode) {
		t.Fatalf("err=%v", err)
	}
}

func TestLegacyJSONStillJoins(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	snap, err := svc.Start([]Source{{Name: "legacy.txt", Data: []byte("old")}}, Limits{MaxDownloads: 2}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(snap.Payload, "mw1.") {
		t.Fatalf("payload=%q", snap.Payload)
	}
	legacy := `{"v":1,"kind":"miao","addr":"` + snap.Address + `","token":"` + snap.Token + `"}`
	dest := t.TempDir()
	receipt, err := svc.Join(context.Background(), legacy, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(receipt.Files) != 1 || receipt.Files[0].Name != "legacy.txt" {
		t.Fatalf("receipt=%+v", receipt.Files)
	}
	body, err := os.ReadFile(receipt.Files[0].Path)
	if err != nil || string(body) != "old" {
		t.Fatalf("body=%q err=%v", body, err)
	}
	again, err := svc.Join(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Files) != 1 || again.Files[0].Name != "legacy.txt" {
		t.Fatalf("compact receipt=%+v", again.Files)
	}
}

func names(entries []os.DirEntry) []string {
	out := make([]string, len(entries))
	for i, entry := range entries {
		out[i] = entry.Name()
	}
	return out
}

func waitEmpty(t *testing.T, root string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		entries, err := os.ReadDir(root)
		if err == nil && len(entries) == 0 {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	entries, _ := os.ReadDir(root)
	t.Fatalf("share dir not removed: %v", names(entries))
}
