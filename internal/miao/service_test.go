package miao

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	var stored []string
	for _, entry := range staged {
		if entry.Name() == "share.json" {
			continue
		}
		stored = append(stored, entry.Name())
	}
	if len(stored) != 1 || stored[0] == "笔记.txt" {
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
	waitGone(t, filepath.Join(root, first.ID))
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

func TestReceiveProgressAndQueuedPull(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	events := collectReceive(t, svc)
	payload := bytes.Repeat([]byte("a"), chunkSize+32)
	snap, err := svc.Start([]Source{{Name: "big.bin", Data: payload}}, Limits{MaxDownloads: 3}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "chunk")
	firstDest := t.TempDir()
	first, err := svc.StartReceive(context.Background(), snap.Payload, firstDest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != receiveConnecting || first.ID == "" {
		t.Fatalf("job=%+v", first)
	}
	partial := waitReceive(t, events, first.ID, receiveDownloading, func(job ReceiveJob) bool {
		return job.BytesDone > 0 && job.BytesDone < int64(len(payload)) && len(job.Files) == 1 && job.Files[0].Name == "big.bin"
	})
	if partial.BytesTotal != int64(len(payload)) {
		t.Fatalf("total=%d", partial.BytesTotal)
	}
	secondDest := t.TempDir()
	second, err := svc.StartReceive(context.Background(), snap.Payload, secondDest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	queued := waitReceive(t, events, second.ID, receiveQueued, nil)
	if queued.BytesDone != 0 {
		t.Fatalf("queued progress=%d", queued.BytesDone)
	}
	release()
	doneFirst := waitReceive(t, events, first.ID, receiveDone, nil)
	doneSecond := waitReceive(t, events, second.ID, receiveDone, nil)
	if doneFirst.BytesDone != int64(len(payload)) || doneSecond.BytesDone != int64(len(payload)) {
		t.Fatalf("done=%d %d", doneFirst.BytesDone, doneSecond.BytesDone)
	}
	for _, dir := range []string{firstDest, secondDest} {
		body, err := os.ReadFile(filepath.Join(dir, "big.bin"))
		if err != nil || !bytes.Equal(body, payload) {
			t.Fatalf("saved %s err=%v match=%v", dir, err, err == nil && bytes.Equal(body, payload))
		}
	}
}

func TestReceiveFolderCanChangeBeforeDownload(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	events := collectReceive(t, svc)
	snap, err := svc.Start([]Source{{Name: "note.txt", Data: []byte("hello")}}, Limits{MaxDownloads: 1}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "manifest")
	original := t.TempDir()
	job, err := svc.StartReceive(context.Background(), snap.Payload, original, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	waitReceive(t, events, job.ID, receiveConnecting, nil)
	next := t.TempDir()
	if err := svc.SetReceiveDest(job.ID, next); err != nil {
		t.Fatal(err)
	}
	release()
	done := waitReceive(t, events, job.ID, receiveDone, nil)
	if done.Dest != next {
		t.Fatalf("dest=%s", done.Dest)
	}
	body, err := os.ReadFile(filepath.Join(next, "note.txt"))
	if err != nil || string(body) != "hello" {
		t.Fatalf("body=%q err=%v", body, err)
	}
	entries, err := os.ReadDir(original)
	if err != nil || len(entries) != 0 {
		t.Fatalf("original=%v err=%v", entries, err)
	}
	if err := svc.SetReceiveDest(job.ID, t.TempDir()); !errors.Is(err, ErrReceiveStarted) {
		t.Fatalf("err=%v", err)
	}
}

func TestCancelReceiveKeepsPartialFile(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	events := collectReceive(t, svc)
	payload := bytes.Repeat([]byte("z"), chunkSize+8)
	snap, err := svc.Start([]Source{{Name: "partial.bin", Data: payload}}, Limits{MaxDownloads: 2}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "chunk")
	dest := t.TempDir()
	job, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	partial := waitReceive(t, events, job.ID, receiveDownloading, func(job ReceiveJob) bool { return job.BytesDone > 0 })
	if err := svc.CancelReceive(job.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelReceive("missing"); !errors.Is(err, ErrUnknownReceive) {
		t.Fatalf("err=%v", err)
	}
	stopped := waitReceive(t, events, job.ID, receiveInterrupted, nil)
	if stopped.Error != "" || !stopped.Resumable || stopped.BytesDone != partial.BytesDone {
		t.Fatalf("stopped=%+v", stopped)
	}
	release()
	if _, err := os.Stat(filepath.Join(dest, "partial.bin")); !os.IsNotExist(err) {
		t.Fatalf("finalized early err=%v", err)
	}
	part := findPart(t, dest)
	info, err := os.Stat(part)
	if err != nil || info.Size() != partial.BytesDone {
		t.Fatalf("part=%s size=%v err=%v", part, info, err)
	}
	if err := svc.DiscardReceive(job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, partialRootName)); !os.IsNotExist(err) {
		t.Fatalf("partial left err=%v", err)
	}
	if _, err := svc.StartReceive(context.Background(), "not-a-code", dest, adapter.NetworkOpts{}); !errors.Is(err, ErrBadCode) {
		t.Fatalf("err=%v", err)
	}
	if _, err := svc.StartReceive(context.Background(), snap.Payload, " ", adapter.NetworkOpts{}); !errors.Is(err, ErrNeedDir) {
		t.Fatalf("err=%v", err)
	}
}

func TestReceiveResumeContinuesFromPartial(t *testing.T) {
	ad := adapter.NewFake()
	host := New(ad, t.TempDir())
	recvRoot := t.TempDir()
	recv := New(ad, recvRoot)
	events := collectReceive(t, recv)
	payload := bytes.Repeat([]byte("r"), chunkSize+8)
	snap, err := host.Start([]Source{{Name: "resume.bin", Data: payload}}, Limits{MaxDownloads: 4}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "chunk")
	dest := t.TempDir()
	job, err := recv.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	partial := waitReceive(t, events, job.ID, receiveDownloading, func(job ReceiveJob) bool {
		return job.BytesDone > 0 && job.BytesDone < int64(len(payload))
	})
	if err := recv.CancelReceive(job.ID); err != nil {
		t.Fatal(err)
	}
	stopped := waitReceive(t, events, job.ID, receiveInterrupted, nil)
	if stopped.BytesDone != partial.BytesDone {
		t.Fatalf("kept=%d want %d", stopped.BytesDone, partial.BytesDone)
	}
	sent := armTransfer(t, "sent")
	release()
	waitArmed(t, sent, "sent")

	again := New(ad, recvRoot)
	againEvents := collectReceive(t, again)
	listed := again.ListReceives()
	if len(listed) != 1 || listed[0].ID != job.ID || listed[0].BytesDone != stopped.BytesDone || listed[0].Status != receiveInterrupted {
		t.Fatalf("listed=%+v", listed)
	}
	resumed, err := again.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if resumed.ID != job.ID || resumed.BytesDone != stopped.BytesDone || resumed.BytesDone == 0 {
		t.Fatalf("resumed=%+v want %d", resumed, stopped.BytesDone)
	}
	waitReceive(t, againEvents, job.ID, receiveDownloading, func(job ReceiveJob) bool {
		return job.BytesDone >= stopped.BytesDone && job.BytesDone < int64(len(payload))
	})
	done := waitReceive(t, againEvents, job.ID, receiveDone, nil)
	if done.BytesDone != int64(len(payload)) {
		t.Fatalf("done=%d", done.BytesDone)
	}
	body, err := os.ReadFile(filepath.Join(dest, "resume.bin"))
	if err != nil || !bytes.Equal(body, payload) {
		t.Fatalf("saved err=%v match=%v", err, err == nil && bytes.Equal(body, payload))
	}
	if _, err := os.Stat(filepath.Join(dest, partialRootName)); !os.IsNotExist(err) {
		t.Fatalf("partial remains err=%v", err)
	}
	for _, listedJob := range again.ListReceives() {
		if listedJob.ID == job.ID {
			t.Fatalf("finished download still listed: %+v", listedJob)
		}
	}
	host.Close()
	recv.Close()
	again.Close()
}

func TestReceiveResumeLengthMismatchRefetches(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	events := collectReceive(t, svc)
	payload := bytes.Repeat([]byte("m"), chunkSize+8)
	snap, err := svc.Start([]Source{{Name: "len.bin", Data: payload}}, Limits{MaxDownloads: 4}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "chunk")
	dest := t.TempDir()
	job, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	waitReceive(t, events, job.ID, receiveDownloading, func(job ReceiveJob) bool { return job.BytesDone > 0 })
	if err := svc.CancelReceive(job.ID); err != nil {
		t.Fatal(err)
	}
	waitReceive(t, events, job.ID, receiveInterrupted, nil)
	sent := armTransfer(t, "sent")
	release()
	waitArmed(t, sent, "sent")
	part := findPart(t, dest)
	info, err := os.Stat(part)
	if err != nil || info.Size() < 2 {
		t.Fatal(err)
	}
	if err := os.Truncate(part, info.Size()-1); err != nil {
		t.Fatal(err)
	}
	resumed, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if resumed.ID != job.ID {
		t.Fatalf("id=%s want %s", resumed.ID, job.ID)
	}
	done := waitReceive(t, events, job.ID, receiveDone, nil)
	if done.BytesDone != int64(len(payload)) {
		t.Fatalf("done=%d", done.BytesDone)
	}
	body, err := os.ReadFile(filepath.Join(dest, "len.bin"))
	if err != nil || !bytes.Equal(body, payload) {
		t.Fatalf("saved err=%v", err)
	}
}

func TestReceiveResumeCorruptPartialFailsClearly(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	events := collectReceive(t, svc)
	payload := bytes.Repeat([]byte("c"), chunkSize+8)
	snap, err := svc.Start([]Source{{Name: "bad.bin", Data: payload}}, Limits{MaxDownloads: 4}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "chunk")
	dest := t.TempDir()
	job, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	waitReceive(t, events, job.ID, receiveDownloading, func(job ReceiveJob) bool { return job.BytesDone > 0 })
	if err := svc.CancelReceive(job.ID); err != nil {
		t.Fatal(err)
	}
	waitReceive(t, events, job.ID, receiveInterrupted, nil)
	sent := armTransfer(t, "sent")
	release()
	waitArmed(t, sent, "sent")
	part := findPart(t, dest)
	body, err := os.ReadFile(part)
	if err != nil || len(body) == 0 {
		t.Fatal(err)
	}
	body[0] ^= 0xff
	if err := os.WriteFile(part, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{}); err != nil {
		t.Fatal(err)
	}
	failed := waitReceive(t, events, job.ID, receiveFailed, nil)
	if failed.Error != ErrPartialMismatch.Error() {
		t.Fatalf("failed=%+v", failed)
	}
	if _, err := os.Stat(part); !os.IsNotExist(err) {
		t.Fatalf("corrupt part kept err=%v", err)
	}
	again, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if again.BytesDone != 0 {
		t.Fatalf("retry started at %d", again.BytesDone)
	}
	done := waitReceive(t, events, job.ID, receiveDone, nil)
	if done.BytesDone != int64(len(payload)) {
		t.Fatalf("done=%d", done.BytesDone)
	}
	saved, err := os.ReadFile(filepath.Join(dest, "bad.bin"))
	if err != nil || !bytes.Equal(saved, payload) {
		t.Fatalf("saved err=%v", err)
	}
}

func TestReceiveResumeRejectsEndedShare(t *testing.T) {
	root := t.TempDir()
	svc := New(adapter.NewFake(), root)
	events := collectReceive(t, svc)
	payload := bytes.Repeat([]byte("e"), chunkSize+8)
	snap, err := svc.Start([]Source{{Name: "ended.bin", Data: payload}}, Limits{MaxDownloads: 4}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "chunk")
	dest := t.TempDir()
	job, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	waitReceive(t, events, job.ID, receiveDownloading, func(job ReceiveJob) bool { return job.BytesDone > 0 })
	if err := svc.CancelReceive(job.ID); err != nil {
		t.Fatal(err)
	}
	waitReceive(t, events, job.ID, receiveInterrupted, nil)
	sent := armTransfer(t, "sent")
	release()
	waitArmed(t, sent, "sent")
	if err := svc.End(snap.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.StartReceive(context.Background(), snap.Payload, dest, adapter.NetworkOpts{}); err != nil {
		t.Fatal(err)
	}
	failed := waitReceive(t, events, job.ID, receiveInterrupted, func(job ReceiveJob) bool { return job.Error != "" })
	if failed.Error != ErrUnreachable.Error() && failed.Error != ErrEnded.Error() {
		t.Fatalf("error=%q", failed.Error)
	}
	if err := svc.DiscardReceive(job.ID); err != nil {
		t.Fatal(err)
	}
	if len(svc.ListReceives()) != 0 {
		t.Fatalf("still listed: %+v", svc.ListReceives())
	}
}

func findPart(t *testing.T, dest string) string {
	t.Helper()
	var found string
	err := filepath.WalkDir(filepath.Join(dest, partialRootName), func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && strings.HasSuffix(path, ".part") {
			found = path
		}
		return nil
	})
	if err != nil || found == "" {
		t.Fatalf("part file err=%v path=%s", err, found)
	}
	return found
}

func armTransfer(t *testing.T, stage string) <-chan struct{} {
	t.Helper()
	hit := make(chan struct{})
	var once sync.Once
	prev := currentTransferHook()
	setTransferHook(func(got string) {
		if prev != nil {
			prev(got)
		}
		if got == stage {
			once.Do(func() { close(hit) })
		}
	})
	return hit
}

func waitArmed(t *testing.T, hit <-chan struct{}, stage string) {
	t.Helper()
	select {
	case <-hit:
	case <-time.After(8 * time.Second):
		t.Fatalf("timed out waiting for transfer stage %s", stage)
	}
}

func TestTransferDoesNotWaitForDirectPath(t *testing.T) {
	root := t.TempDir()
	fake := adapter.NewFake()
	release := fake.HoldPathProbe()
	t.Cleanup(release)
	svc := New(fake, root)
	snap, err := svc.Start([]Source{{Name: "note.txt", Data: []byte("hello")}}, Limits{MaxDownloads: 1}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := svc.Join(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{})
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("download waited for a direct path")
	}
}

func TestPathUpgradesDuringTransfer(t *testing.T) {
	root := t.TempDir()
	fake := adapter.NewFake()
	svc := New(fake, root)
	events := collectEvents(t, svc)
	payload := bytes.Repeat([]byte("a"), chunkSize+8)
	snap, err := svc.Start([]Source{{Name: "big.bin", Data: payload}}, Limits{MaxDownloads: 2}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	release := hookTransfer(t, "chunk")
	job, err := svc.StartReceive(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	var partial, shareDirect bool
	deadline := time.After(3 * time.Second)
	for !partial || !shareDirect || strings.Join(got, ",") != "checking,derp,direct" {
		select {
		case ev := <-events.receive:
			if ev.ID != job.ID {
				continue
			}
			if ev.PeerPath != "" && (len(got) == 0 || got[len(got)-1] != ev.PeerPath) {
				got = append(got, ev.PeerPath)
			}
			if ev.Status == receiveDownloading && ev.PeerPath == adapter.PathDirect && ev.BytesDone > 0 && ev.BytesDone < int64(len(payload)) {
				partial = true
			}
		case share := <-events.share:
			if share.ID == snap.ID && share.Status == "active" && share.PeerPath == adapter.PathDirect {
				shareDirect = true
			}
		case <-deadline:
			t.Fatalf("paths=%v partial=%v shareDirect=%v", got, partial, shareDirect)
		}
	}
	release()
	done := waitReceive(t, events.receive, job.ID, receiveDone, nil)
	if done.BytesDone != int64(len(payload)) {
		t.Fatalf("done=%d", done.BytesDone)
	}
	cleared := waitSharePath(t, events, snap.ID, "")
	if cleared.PeerPath != "" || cleared.Status != "active" {
		t.Fatalf("after send path=%q status=%s", cleared.PeerPath, cleared.Status)
	}
}

type liveEvents struct {
	receive chan ReceiveJob
	share   chan Snapshot
}

func collectEvents(t *testing.T, svc *Service) liveEvents {
	t.Helper()
	out := liveEvents{receive: make(chan ReceiveJob, 64), share: make(chan Snapshot, 64)}
	go func() {
		for ev := range svc.Events() {
			switch ev.Kind {
			case "miao-receive":
				var job ReceiveJob
				if json.Unmarshal([]byte(ev.Data), &job) == nil {
					select {
					case out.receive <- job:
					default:
					}
				}
			case "miao":
				var snap Snapshot
				if json.Unmarshal([]byte(ev.Data), &snap) == nil {
					select {
					case out.share <- snap:
					default:
					}
				}
			}
		}
	}()
	return out
}

func waitSharePath(t *testing.T, events liveEvents, id, path string) Snapshot {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case snap := <-events.share:
			if snap.ID == id && snap.PeerPath == path && snap.Status == "active" {
				return snap
			}
		case <-deadline:
			t.Fatalf("timed out waiting for share %s path %q", id, path)
		}
	}
}

func hookTransfer(t *testing.T, stage string) func() {
	t.Helper()
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	var releaseOnce sync.Once
	setTransferHook(func(got string) {
		if got != stage {
			return
		}
		once.Do(func() {
			close(entered)
			<-release
		})
	})
	unlock := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(func() {
		setTransferHook(nil)
		unlock()
	})
	return func() {
		select {
		case <-entered:
		case <-time.After(8 * time.Second):
			t.Errorf("timed out waiting for transfer stage %s", stage)
		}
		unlock()
	}
}

func collectReceive(t *testing.T, svc *Service) <-chan ReceiveJob {
	t.Helper()
	out := make(chan ReceiveJob, 64)
	go func() {
		for ev := range svc.Events() {
			if ev.Kind != "miao-receive" || ev.Data == "" {
				continue
			}
			var job ReceiveJob
			if err := json.Unmarshal([]byte(ev.Data), &job); err != nil {
				continue
			}
			select {
			case out <- job:
			default:
			}
		}
	}()
	return out
}

func waitReceive(t *testing.T, events <-chan ReceiveJob, id, status string, check func(ReceiveJob) bool) ReceiveJob {
	t.Helper()
	deadline := time.After(8 * time.Second)
	for {
		select {
		case job := <-events:
			if job.ID == id && job.Status == status && (check == nil || check(job)) {
				return job
			}
		case <-deadline:
			t.Fatalf("timed out waiting for %s status %s", id, status)
		}
	}
	return ReceiveJob{}
}

func names(entries []os.DirEntry) []string {
	out := make([]string, len(entries))
	for i, entry := range entries {
		out[i] = entry.Name()
	}
	return out
}

func waitGone(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("ended share still on disk: %v", err)
	}
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

func waitWarning(t *testing.T, svc *Service, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		listed := svc.List()
		if len(listed) == 1 && listed[0].Warning == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("warning=%q listed=%+v", want, listed)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestByRefShareServesOriginalAndNoticesMoves(t *testing.T) {
	setCopyLimit(t, 4)
	root := t.TempDir()
	srcDir := filepath.Join(t.TempDir(), "secret-origin")
	if err := os.Mkdir(srcDir, 0o700); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "note.txt")
	body := []byte("hello")
	if err := os.WriteFile(src, body, 0o600); err != nil {
		t.Fatal(err)
	}
	svc := New(adapter.NewFake(), root)
	snap, err := svc.Start([]Source{{Name: "note.txt", Path: src}}, Limits{MaxDownloads: 4}, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if !snap.ByRef || snap.Warning != "" || len(snap.Files) != 1 || snap.Files[0].Name != "note.txt" {
		t.Fatalf("snap=%+v", snap)
	}
	published, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(published), "secret-origin") || strings.Contains(string(published), src) {
		t.Fatalf("origin path leaked: %s", published)
	}
	shareDir := filepath.Join(root, snap.ID)
	entries, err := os.ReadDir(shareDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "share.json" {
		t.Fatalf("share dir=%v", names(entries))
	}
	state, err := os.ReadFile(filepath.Join(shareDir, "share.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(state), `"byRef": true`) || !strings.Contains(string(state), src) {
		t.Fatalf("state=%s", state)
	}

	dest := t.TempDir()
	receipt, err := svc.Join(context.Background(), snap.Payload, dest, adapter.NetworkOpts{})
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(receipt.Files[0].Path)
	if err != nil || string(got) != "hello" || receipt.Files[0].Name != "note.txt" {
		t.Fatalf("got=%q receipt=%+v err=%v", got, receipt.Files, err)
	}
	if listed := svc.List(); len(listed) != 1 || listed[0].Downloads != 1 {
		t.Fatalf("after download=%+v", listed)
	}

	moved := filepath.Join(srcDir, "moved.txt")
	if err := os.Rename(src, moved); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Join(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{}); !errors.Is(err, ErrOriginGone) {
		t.Fatalf("moved err=%v", err)
	}
	waitWarning(t, svc, ErrOriginGone.Error())
	if listed := svc.List(); len(listed) != 1 || listed[0].Downloads != 1 || listed[0].Status != "active" {
		t.Fatalf("share changed after move: %+v", listed)
	}
	if err := os.Rename(moved, src); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Join(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{}); err != nil {
		t.Fatal(err)
	}
	waitWarning(t, svc, "")
	if listed := svc.List(); len(listed) != 1 || listed[0].Downloads != 2 {
		t.Fatalf("after restore=%+v", listed)
	}

	if err := os.WriteFile(src, []byte("HELLO"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Join(context.Background(), snap.Payload, t.TempDir(), adapter.NetworkOpts{}); !errors.Is(err, ErrOriginGone) {
		t.Fatalf("changed err=%v", err)
	}
	if err := os.WriteFile(src, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := svc.End(snap.ID); err != nil {
		t.Fatal(err)
	}
	waitGone(t, shareDir)
	kept, err := os.ReadFile(src)
	if err != nil || string(kept) != "hello" {
		t.Fatalf("ending the share changed the original: %q %v", kept, err)
	}
}
