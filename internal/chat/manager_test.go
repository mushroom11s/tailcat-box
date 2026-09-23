package chat

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
)

func waitRoomRunning(t *testing.T, m *Manager, id string) session.Session {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		for _, item := range m.Sessions() {
			if item.ID == id && item.Status == session.StatusRunning && item.Address != "" {
				return item
			}
		}
		select {
		case <-deadline:
			t.Fatalf("room %s not running: %+v", id, m.Sessions())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestManagerTwoRoomsAndStopOne(t *testing.T) {
	m := NewManager(adapter.NewFake(), t.TempDir())
	a, err := m.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	readyA := waitRoomRunning(t, m, a.ID)
	readyB := waitRoomRunning(t, m, b.ID)
	if readyA.Address == readyB.Address {
		t.Fatalf("addresses %s %s", readyA.Address, readyB.Address)
	}
	if m.Focus() != b.ID {
		t.Fatalf("focus=%s want newest %s", m.Focus(), b.ID)
	}
	if order := m.Order(); len(order) != 2 || order[0] != b.ID || order[1] != a.ID {
		t.Fatalf("order=%v", order)
	}
	if err := m.Stop(b.ID); err != nil {
		t.Fatal(err)
	}
	if m.Focus() != a.ID {
		t.Fatalf("focus after stop=%s", m.Focus())
	}
	left := m.Sessions()
	if len(left) != 1 || left[0].ID != a.ID || left[0].Status != session.StatusRunning {
		t.Fatalf("%+v", left)
	}
	if err := m.Stop(a.ID); err != nil {
		t.Fatal(err)
	}
	if m.Focus() != "" || !m.Lobby() || len(m.Sessions()) != 0 {
		t.Fatalf("focus=%s lobby=%v sessions=%+v", m.Focus(), m.Lobby(), m.Sessions())
	}
}

func TestManagerTranscriptsStayApart(t *testing.T) {
	m := NewManager(adapter.NewFake(), t.TempDir())
	a, err := m.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	waitRoomRunning(t, m, a.ID)
	waitRoomRunning(t, m, b.ID)
	if err := m.Connect(a.ID, "tc:fake-echo"); err != nil {
		t.Fatal(err)
	}
	if err := m.SendText(a.ID, "hi", false, 0); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for {
		msgs, err := m.Messages(a.ID)
		if err != nil {
			t.Fatal(err)
		}
		got := false
		for _, msg := range msgs {
			if msg.Direction == "in" && msg.Body == "echo" {
				got = true
			}
		}
		if got {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("room A messages %+v", msgs)
		case <-time.After(10 * time.Millisecond):
		}
	}
	other, err := m.Messages(b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("room B saw %+v", other)
	}
	if err := m.Connect("missing", "tc:fake-echo"); !errors.Is(err, ErrUnknownRoom) {
		t.Fatalf("unknown connect: %v", err)
	}
	peer, err := m.Peer(b.ID)
	if err != nil || peer != "" {
		t.Fatalf("peer=%q err=%v", peer, err)
	}
}

func TestManagerCapRefusesNinth(t *testing.T) {
	m := NewManager(adapter.NewFake(), t.TempDir())
	const extra = 4
	var wg sync.WaitGroup
	n := DefaultRoomCap + extra
	wg.Add(n)
	start := make(chan struct{})
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			<-start
			_, errs[i] = m.Start(StartOpts{})
		}(i)
	}
	close(start)
	wg.Wait()
	ok, refused := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrRoomCap):
			refused++
		default:
			t.Fatal(err)
		}
	}
	if ok != DefaultRoomCap || refused != extra {
		t.Fatalf("ok=%d refused=%d", ok, refused)
	}
	if got := len(m.Sessions()); got != DefaultRoomCap {
		t.Fatalf("sessions=%d", got)
	}
	if _, err := m.Start(StartOpts{}); !errors.Is(err, ErrRoomCap) {
		t.Fatalf("ninth=%v", err)
	}
}

func TestManagerSameKeyTwice(t *testing.T) {
	m := NewManager(adapter.NewFake(), t.TempDir())
	opts := StartOpts{KeyName: "home", PrivateKeyJSON: `{"fake":"alpha"}`}
	first, err := m.Start(opts)
	if err != nil {
		t.Fatal(err)
	}
	waitRoomRunning(t, m, first.ID)
	if _, err := m.Start(opts); !errors.Is(err, ErrKeyInUse) {
		t.Fatalf("second=%v", err)
	}
	if got := m.Sessions(); len(got) != 1 || got[0].ID != first.ID || got[0].Status != session.StatusRunning {
		t.Fatalf("%+v", got)
	}
	again, err := m.Restart(first.ID, opts)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID == "" {
		t.Fatal("restart lost the room")
	}
	if name, ok := m.KeyName(again.ID); !ok || name != "home" {
		t.Fatalf("key=%q ok=%v", name, ok)
	}
}

func TestManagerDataDirsArePerRoom(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, inboxDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, inboxDirName, "old"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "stale-room"), 0o755); err != nil {
		t.Fatal(err)
	}
	m := NewManager(adapter.NewFake(), root)
	if _, err := os.Stat(filepath.Join(root, inboxDirName, "old")); !os.IsNotExist(err) {
		t.Fatal("legacy inbox was not swept")
	}
	if _, err := os.Stat(filepath.Join(root, "stale-room")); !os.IsNotExist(err) {
		t.Fatal("stale room dir remains")
	}
	a, err := m.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	dirA := m.rooms[a.ID].svc.dataDir
	dirB := m.rooms[b.ID].svc.dataDir
	m.mu.Unlock()
	if dirA == "" || dirB == "" || dirA == dirB {
		t.Fatalf("dirs %q %q", dirA, dirB)
	}
	if !filepath.IsAbs(dirA) && filepath.Base(dirA) != a.ID {
		t.Fatalf("dir A %s", dirA)
	}
	if filepath.Base(dirA) != a.ID || filepath.Base(dirB) != b.ID {
		t.Fatalf("bases %s %s", dirA, dirB)
	}
}
