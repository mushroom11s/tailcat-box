package adapter

import (
	"context"
	"strings"
	"testing"
	"time"
)

func readReady(t *testing.T, room Room) string {
	t.Helper()
	select {
	case ev := <-room.Events():
		if ev.Kind != ChatEventReady || !strings.HasPrefix(ev.Address, "tc:") {
			t.Fatalf("event=%+v", ev)
		}
		return ev.Address
	case <-time.After(2 * time.Second):
		t.Fatal("no ready event")
	}
	return ""
}

func TestFakeTwoRoomsDeliverText(t *testing.T) {
	fake := NewFake()
	ctx := context.Background()
	a, err := fake.StartRoom(ctx, RoomOpts{SessionID: "aaa"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := fake.StartRoom(ctx, RoomOpts{SessionID: "bbb"})
	if err != nil {
		t.Fatal(err)
	}
	addrA := readReady(t, a)
	addrB := readReady(t, b)
	if err := a.SetPeer(addrB); err != nil {
		t.Fatal(err)
	}
	frame := []byte("TCH1frame-from-a")
	if err := a.SendEnvelope(ctx, 101, frame); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-b.Events():
		if ev.Kind != ChatEventInbound || ev.Port != 101 || string(ev.Data) != string(frame) {
			t.Fatalf("%+v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("b got nothing")
	}
	if addrA == addrB {
		t.Fatal("addresses must differ")
	}
}

func TestFakeEchoAnswersTextOnly(t *testing.T) {
	fake := NewFake()
	ctx := context.Background()
	room, err := fake.StartRoom(ctx, RoomOpts{SessionID: "echo1"})
	if err != nil {
		t.Fatal(err)
	}
	_ = readReady(t, room)
	if err := room.SetPeer("tc:fake-echo"); err != nil {
		t.Fatal(err)
	}
	if err := room.SendEnvelope(ctx, 100, []byte("hello-frame")); err != nil {
		t.Fatal(err)
	}
	if err := room.SendEnvelope(ctx, 101, []byte("text-frame")); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-room.Events():
		if ev.Port != 101 || !strings.Contains(string(ev.Data), "echo") {
			t.Fatalf("%+v data=%s", ev, ev.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no echo")
	}
}

func TestFakeSavedKeyChangesAddress(t *testing.T) {
	fake := NewFake()
	ctx := context.Background()
	ephemeral, err := fake.StartRoom(ctx, RoomOpts{SessionID: "s1"})
	if err != nil {
		t.Fatal(err)
	}
	addr1 := readReady(t, ephemeral)
	_ = ephemeral.Close()
	keyed, err := fake.StartRoom(ctx, RoomOpts{SessionID: "s2", PrivateKeyJSON: `{"fake":"alpha"}`})
	if err != nil {
		t.Fatal(err)
	}
	addr2 := readReady(t, keyed)
	_ = keyed.Close()
	again, err := fake.StartRoom(ctx, RoomOpts{SessionID: "s3", PrivateKeyJSON: `{"fake":"alpha"}`})
	if err != nil {
		t.Fatal(err)
	}
	addr3 := readReady(t, again)
	if !strings.HasPrefix(addr1, "tc:fake-room-s1") {
		t.Fatalf("ephemeral=%s", addr1)
	}
	if addr2 == addr1 || !strings.HasPrefix(addr2, "tc:fake-room-key-") {
		t.Fatalf("keyed=%s", addr2)
	}
	if addr3 != addr2 {
		t.Fatalf("same key %s vs %s", addr2, addr3)
	}
}

func TestGeneratePrivateKeyJSON(t *testing.T) {
	fake := NewFake()
	a, err := fake.GeneratePrivateKeyJSON()
	if err != nil || !strings.Contains(a, "fake") {
		t.Fatalf("%s %v", a, err)
	}
	b, err := fake.GeneratePrivateKeyJSON()
	if err != nil || a == b {
		t.Fatalf("expected unique material %s %s", a, b)
	}
	real := NewReal()
	raw, err := real.GeneratePrivateKeyJSON()
	if err != nil || !strings.Contains(raw, "Private") {
		t.Fatalf("%s %v", raw, err)
	}
}
