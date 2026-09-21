package chat

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
)

func waitRunning(t *testing.T, svc *Service) session.Session {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		sess, ok := svc.Session()
		if ok && sess.Status == session.StatusRunning && strings.HasPrefix(sess.Address, "tc:") {
			return sess
		}
		select {
		case <-deadline:
			t.Fatalf("not running: %+v", sess)
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestStartIsIdempotentAndStop(t *testing.T) {
	svc := New(adapter.NewFake())
	first, err := svc.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if first.Kind != session.KindChat {
		t.Fatalf("kind=%s", first.Kind)
	}
	ready := waitRunning(t, svc)
	second, err := svc.Start(StartOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != ready.ID || second.Address != ready.Address {
		t.Fatalf("second=%+v ready=%+v", second, ready)
	}
	if err := svc.Stop(); err != nil {
		t.Fatal(err)
	}
	stopped, ok := svc.Session()
	if !ok || stopped.Status != session.StatusStopped || svc.Peer() != "" {
		t.Fatalf("stopped=%+v peer=%s", stopped, svc.Peer())
	}
}

func TestPeerChangeKeepsEarlierText(t *testing.T) {
	fake := adapter.NewFake()
	a := New(fake)
	b := New(fake)
	c := New(fake)
	if _, err := a.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	readyB := waitRunning(t, b)
	readyC := waitRunning(t, c)
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	if err := a.SendText("first"); err != nil {
		t.Fatal(err)
	}
	if err := a.Connect(readyC.Address); err != nil {
		t.Fatal(err)
	}
	if a.Peer() != readyC.Address || !hasBody(a, "out", "first") || countCode(a, codePeerChanged) != 1 {
		t.Fatalf("peer=%s messages=%+v", a.Peer(), a.Messages())
	}
}

func TestHelloOnceAndTextBothWays(t *testing.T) {
	fake := adapter.NewFake()
	a := New(fake)
	b := New(fake)
	if _, err := a.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	readyA := waitRunning(t, a)
	readyB := waitRunning(t, b)
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for b.Peer() != readyA.Address || countCode(b, codeHearMeow) != 1 {
		select {
		case <-deadline:
			t.Fatalf("peer=%s messages=%+v", b.Peer(), b.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if countCode(b, codeHearMeow) != 1 {
		t.Fatalf("duplicated hear meow: %+v", b.Messages())
	}
	if err := b.SendText("from-b"); err != nil {
		t.Fatal(err)
	}
	if err := a.SendText("from-a"); err != nil {
		t.Fatal(err)
	}
	deadline = time.After(2 * time.Second)
	for !hasBody(a, "in", "from-b") || !hasBody(b, "in", "from-a") {
		select {
		case <-deadline:
			t.Fatalf("a=%+v b=%+v", a.Messages(), b.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestConnectHelloAdvertisesBurnAndResume(t *testing.T) {
	mem := newMemAdapter()
	svc := New(mem)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:peer"); err != nil {
		t.Fatal(err)
	}
	if len(mem.sent) != 1 || mem.sent[0].port != 100 {
		t.Fatalf("sent=%+v", mem.sent)
	}
	meta, _, err := Unpack(mem.sent[0].frame)
	if err != nil {
		t.Fatal(err)
	}
	if meta["type"] != "hello" || meta["replyTo"] == "" {
		t.Fatalf("meta=%v", meta)
	}
	caps, ok := meta["caps"].([]any)
	if !ok || len(caps) != 2 || caps[0] != "burn" || caps[1] != "resume" {
		t.Fatalf("caps=%v", meta["caps"])
	}
}

func TestEchoBadFramePort1AndRestart(t *testing.T) {
	svc := New(adapter.NewFake())
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	ready := waitRunning(t, svc)
	if err := svc.Connect("tc:not-a-real-peer"); err == nil || err.Error() != errUnreachable {
		t.Fatalf("%v", err)
	}
	if err := svc.Connect("nope"); err == nil || err.Error() != errBadAddr {
		t.Fatalf("%v", err)
	}
	if err := svc.Connect("tc:fake-echo"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendText("hi"); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for !hasBody(svc, "in", "echo") {
		select {
		case <-deadline:
			t.Fatalf("%+v", svc.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
	mem := newMemAdapter()
	other := New(mem)
	if _, err := other.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, other)
	mem.push(adapter.ChatEvent{Kind: adapter.ChatEventInbound, Port: 1, Data: []byte("raw")})
	mem.push(adapter.ChatEvent{Kind: adapter.ChatEventInbound, Port: 101, Data: []byte("not-tch1")})
	mem.push(adapter.ChatEvent{Kind: adapter.ChatEventInbound, Port: 101, Data: mustPack(t, map[string]any{"type": "nope"}, nil)})
	time.Sleep(40 * time.Millisecond)
	if countCode(other, codeBadFrame) != 1 {
		t.Fatalf("%+v", other.Messages())
	}
	if hasBody(other, "in", "raw") {
		t.Fatal("port 1 became a bubble")
	}
	seenData := false
	deadline = time.After(time.Second)
	for !seenData {
		select {
		case ev := <-other.Events():
			if ev.Kind == adapter.EventData && ev.Data == "ignored port 1 stream" {
				seenData = true
			}
		case <-deadline:
			t.Fatal("missing port 1 diagnostic")
		}
	}
	if err := svc.SendText("keep-me"); err != nil {
		t.Fatal(err)
	}
	next, err := svc.Restart(StartOpts{PrivateKeyJSON: `{"fake":"beta"}`})
	if err != nil {
		t.Fatal(err)
	}
	again := waitRunning(t, svc)
	if again.ID != next.ID || again.Address == ready.Address || !strings.HasPrefix(again.Address, "tc:fake-room-key-") {
		t.Fatalf("again=%+v old=%s", again, ready.Address)
	}
	if svc.Peer() != "" || !hasBody(svc, "out", "keep-me") || countCode(svc, codeRoomRestarted) != 1 {
		t.Fatalf("peer=%s messages=%+v", svc.Peer(), svc.Messages())
	}
}

func countCode(s *Service, code string) int {
	n := 0
	for _, msg := range s.Messages() {
		if msg.Code == code {
			n++
		}
	}
	return n
}

func hasBody(s *Service, direction, body string) bool {
	for _, msg := range s.Messages() {
		if msg.Direction == direction && msg.Body == body {
			return true
		}
	}
	return false
}

func mustPack(t *testing.T, meta map[string]any, payload []byte) []byte {
	t.Helper()
	frame, err := Pack(meta, payload)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

type sentFrame struct {
	port  uint16
	frame []byte
}

type memAdapter struct {
	mu   sync.Mutex
	sent []sentFrame
	room *memRoom
	gate chan struct{}
}

func newMemAdapter() *memAdapter { return &memAdapter{} }

func (m *memAdapter) StartRoom(ctx context.Context, opts adapter.RoomOpts) (adapter.Room, error) {
	room := &memRoom{id: opts.SessionID, addr: "tc:fake-room-" + opts.SessionID, events: make(chan adapter.ChatEvent, 8), mem: m}
	m.room = room
	room.events <- adapter.ChatEvent{SessionID: room.id, Kind: adapter.ChatEventReady, Address: room.addr}
	return room, nil
}

func (m *memAdapter) push(ev adapter.ChatEvent) {
	m.room.events <- ev
}

type memRoom struct {
	id     string
	addr   string
	peer   string
	events chan adapter.ChatEvent
	mem    *memAdapter
}

func (r *memRoom) SessionID() string { return r.id }
func (r *memRoom) Address() string   { return r.addr }
func (r *memRoom) Events() <-chan adapter.ChatEvent {
	return r.events
}
func (r *memRoom) SetPeer(addr string) error { r.peer = addr; return nil }
func (r *memRoom) Close() error              { return nil }
func (r *memRoom) SendEnvelope(ctx context.Context, port uint16, frame []byte) error {
	if r.peer == "tc:not-a-real-peer" {
		return fmt.Errorf("dial failed")
	}
	if r.mem.gate != nil && port == portFiles {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-r.mem.gate:
		}
	}
	r.mem.mu.Lock()
	r.mem.sent = append(r.mem.sent, sentFrame{port: port, frame: append([]byte(nil), frame...)})
	r.mem.mu.Unlock()
	return nil
}
