package adapter_test

import (
	"context"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
)

func TestClassifySessionPathPrefersDirect(t *testing.T) {
	direct := adapter.ClassifySessionPath("203.0.113.5:41641", "nyc", "")
	if direct.Kind != adapter.PathDirect {
		t.Fatalf("kind=%s", direct.Kind)
	}
	relay := adapter.ClassifySessionPath("", "nyc", "")
	if relay.Kind != adapter.PathDERP || relay.Detail != "nyc" {
		t.Fatalf("relay=%+v", relay)
	}
	peerRelay := adapter.ClassifySessionPath("", "", "10.0.0.8:7777")
	if peerRelay.Kind != adapter.PathDERP {
		t.Fatalf("peer relay=%+v", peerRelay)
	}
	checking := adapter.ClassifySessionPath("", "", "")
	if checking.Kind != adapter.PathChecking {
		t.Fatalf("checking=%+v", checking)
	}
}

func TestClassifyDiscoUsesEndpoint(t *testing.T) {
	direct := adapter.ClassifyDisco("203.0.113.5:41641", "nyc", "1")
	if direct.Kind != adapter.PathDirect {
		t.Fatalf("direct=%+v", direct)
	}
	derp := adapter.ClassifyDisco("", "nyc", "1")
	if derp.Kind != adapter.PathDERP || derp.Detail != "nyc" {
		t.Fatalf("derp=%+v", derp)
	}
	idOnly := adapter.ClassifyDisco("", "", "4")
	if idOnly.Kind != adapter.PathDERP || idOnly.Detail != "4" {
		t.Fatalf("id=%+v", idOnly)
	}
}

func TestMergePeerPathPrefersDirect(t *testing.T) {
	merged := adapter.MergePeerPath(
		adapter.PeerPath{Kind: adapter.PathDERP, Detail: "nyc"},
		adapter.PeerPath{Kind: adapter.PathDirect, Detail: "203.0.113.5:1"},
	)
	if merged.Kind != adapter.PathDirect {
		t.Fatalf("merged=%+v", merged)
	}
	derp := adapter.MergePeerPath(
		adapter.PeerPath{Kind: adapter.PathChecking},
		adapter.PeerPath{Kind: adapter.PathDERP, Detail: "nyc"},
	)
	if derp.Kind != adapter.PathDERP {
		t.Fatalf("derp=%+v", derp)
	}
	checking := adapter.MergePeerPath(
		adapter.PeerPath{Kind: adapter.PathChecking},
		adapter.PeerPath{},
	)
	if checking.Kind != adapter.PathChecking {
		t.Fatalf("checking=%+v", checking)
	}
}

func TestWatchPeerPathReturnsImmediatelyAndUpgrades(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	room, err := f.StartRoom(ctx, adapter.RoomOpts{SessionID: "path"})
	if err != nil {
		t.Fatal(err)
	}
	defer room.Close()

	started := time.Now()
	updates := room.WatchPeerPath(ctx, "tc:peer")
	if updates == nil {
		t.Fatal("nil updates")
	}
	if time.Since(started) > 200*time.Millisecond {
		t.Fatal("WatchPeerPath blocked the caller")
	}
	got := readPeerPaths(t, updates, 3)
	want := []string{adapter.PathChecking, adapter.PathDERP, adapter.PathDirect}
	for i, kind := range want {
		if got[i].Kind != kind {
			t.Fatalf("path[%d]=%s want %s", i, got[i].Kind, kind)
		}
	}
}

func TestWatchPeerPathHoldsCheckingUntilReleased(t *testing.T) {
	f := adapter.NewFake()
	release := f.HoldPathProbe()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	room, err := f.StartRoom(ctx, adapter.RoomOpts{SessionID: "held"})
	if err != nil {
		t.Fatal(err)
	}
	defer room.Close()

	updates := room.WatchPeerPath(ctx, "tc:peer")
	first := readPeerPaths(t, updates, 1)
	if first[0].Kind != adapter.PathChecking {
		t.Fatalf("first=%s", first[0].Kind)
	}
	select {
	case extra := <-updates:
		t.Fatalf("probe advanced while held: %+v", extra)
	case <-time.After(40 * time.Millisecond):
	}
	release()
	rest := readPeerPaths(t, updates, 2)
	if rest[0].Kind != adapter.PathDERP || rest[1].Kind != adapter.PathDirect {
		t.Fatalf("after release=%s %s", rest[0].Kind, rest[1].Kind)
	}
}

func readPeerPaths(t *testing.T, updates <-chan adapter.PeerPath, n int) []adapter.PeerPath {
	t.Helper()
	out := make([]adapter.PeerPath, 0, n)
	deadline := time.After(2 * time.Second)
	for len(out) < n {
		select {
		case p, ok := <-updates:
			if !ok {
				t.Fatalf("updates closed after %d values", len(out))
			}
			out = append(out, p)
		case <-deadline:
			t.Fatalf("timed out after %d path updates", len(out))
		}
	}
	return out
}
