package chat

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
)

func TestSendSignalPacksControlAndRejectsBadMeta(t *testing.T) {
	mem := newMemAdapter()
	svc := New(mem)
	if _, err := svc.Start(StartOpts{}); err != nil {
		t.Fatal(err)
	}
	_ = waitRunning(t, svc)
	if err := svc.Connect("tc:peer"); err != nil {
		t.Fatal(err)
	}
	before := len(mem.sent)
	bad := []string{
		"",
		"{",
		"null",
		`{"type":"rtc-offer"}`,
		`{"type":"rtc-offer","mode":"nope","description":{"type":"offer","sdp":"v=0"}}`,
		`{"type":"rtc-offer","mode":"voice"}`,
		`{"type":"rtc-answer"}`,
		`{"type":"text"}`,
	}
	for _, raw := range bad {
		if err := svc.SendSignal(raw); err == nil || err.Error() != "invalid signal" {
			t.Fatalf("%s -> %v", raw, err)
		}
	}
	if len(mem.sent) != before {
		t.Fatalf("invalid signal dialed: %+v", mem.sent[before:])
	}
	offer := `{"type":"rtc-offer","mode":"video","description":{"type":"offer","sdp":"v=0"},"v":2}`
	if err := svc.SendSignal(offer); err != nil {
		t.Fatal(err)
	}
	answer := `{"type":"rtc-answer","description":{"type":"answer","sdp":"v=answer"}}`
	if err := svc.SendSignal(answer); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendSignal(`{"type":"rtc-hangup"}`); err != nil {
		t.Fatal(err)
	}
	frames := mem.sent[before:]
	if len(frames) != 3 {
		t.Fatalf("sent=%d", len(frames))
	}
	want := []string{"rtc-offer", "rtc-answer", "rtc-hangup"}
	for i, frame := range frames {
		if frame.port != portControl {
			t.Fatalf("port=%d", frame.port)
		}
		meta, payload, err := Unpack(frame.frame)
		if err != nil {
			t.Fatal(err)
		}
		if meta["type"] != want[i] || len(payload) != 0 || meta["v"].(float64) != 1 {
			t.Fatalf("meta=%v payload=%q", meta, payload)
		}
		if want[i] == "rtc-offer" && meta["mode"] != "video" {
			t.Fatalf("mode=%v", meta["mode"])
		}
	}
}

func TestFakeRoomsDeliverWebRTCSignalsAndChatStaysUp(t *testing.T) {
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
	signals := make(chan string, 8)
	go func() {
		for ev := range b.Events() {
			if ev.Kind == "signal" {
				signals <- ev.Data
			}
		}
	}()
	if err := a.Connect(readyB.Address); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for b.Peer() != readyA.Address {
		select {
		case <-deadline:
			t.Fatalf("peer=%s", b.Peer())
		case <-time.After(10 * time.Millisecond):
		}
	}
	before := len(b.Messages())
	raw := `{"v":1,"type":"rtc-offer","mode":"voice","description":{"type":"offer","sdp":"v=0"}}`
	if err := a.SendSignal(raw); err != nil {
		t.Fatal(err)
	}
	if err := a.SendSignal(`{"type":"rtc-answer","description":{"type":"answer","sdp":"v=a"}}`); err != nil {
		t.Fatal(err)
	}
	if err := a.SendSignal(`{"type":"rtc-hangup"}`); err != nil {
		t.Fatal(err)
	}
	got := map[string]map[string]any{}
	deadline = time.After(2 * time.Second)
	for len(got) < 3 {
		select {
		case data := <-signals:
			var meta map[string]any
			if err := json.Unmarshal([]byte(data), &meta); err != nil {
				t.Fatal(err)
			}
			typ, _ := meta["type"].(string)
			got[typ] = meta
		case <-deadline:
			t.Fatalf("signals=%v", got)
		}
	}
	if got["rtc-offer"]["mode"] != "voice" || got["rtc-offer"]["v"].(float64) != 1 {
		t.Fatalf("offer=%v", got["rtc-offer"])
	}
	desc, _ := got["rtc-offer"]["description"].(map[string]any)
	if desc["type"] != "offer" || desc["sdp"] != "v=0" {
		t.Fatalf("description=%v", got["rtc-offer"]["description"])
	}
	if got["rtc-answer"]["type"] != "rtc-answer" || got["rtc-hangup"]["type"] != "rtc-hangup" {
		t.Fatalf("%v", got)
	}
	if len(b.Messages()) != before {
		t.Fatalf("signal became a message: %+v", b.Messages())
	}
	if err := a.SendText("still-here"); err != nil {
		t.Fatal(err)
	}
	deadline = time.After(2 * time.Second)
	for !hasBody(b, "in", "still-here") {
		select {
		case <-deadline:
			t.Fatalf("messages=%+v", b.Messages())
		case <-time.After(10 * time.Millisecond):
		}
	}
}
