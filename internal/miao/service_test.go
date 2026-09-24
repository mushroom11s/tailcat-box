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
	if snap.Status != "active" || snap.Payload == "" || !strings.Contains(snap.Payload, snap.Address) || !strings.Contains(snap.Payload, snap.Token) {
		t.Fatalf("snap=%+v", snap)
	}
	if _, err := ParseJoin(snap.Payload); err != nil {
		t.Fatal(err)
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
	if svc.Status().Status != "idle" {
		t.Fatalf("status=%s", svc.Status().Status)
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
	if svc.Status().Status != "idle" {
		t.Fatalf("status=%s", svc.Status().Status)
	}
}

func TestParseJoinRejectsAddressOnly(t *testing.T) {
	if _, err := ParseJoin("tc:fake-room"); !errors.Is(err, ErrBadCode) {
		t.Fatalf("err=%v", err)
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
