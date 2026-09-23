package adapter

import (
	"context"
	"testing"
)

func TestRealCloseRemovesOnlyThatRoom(t *testing.T) {
	real := NewReal()
	_, cancelA := context.WithCancel(context.Background())
	_, cancelB := context.WithCancel(context.Background())
	a := &realRoom{real: real, id: "a", addr: "tc:a", events: make(chan ChatEvent, 1), cancel: cancelA}
	b := &realRoom{real: real, id: "b", addr: "tc:b", events: make(chan ChatEvent, 1), cancel: cancelB}
	real.chatRooms = map[string]*realRoom{"a": a, "b": b}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	real.mu.Lock()
	defer real.mu.Unlock()
	if _, ok := real.chatRooms["a"]; ok {
		t.Fatal("closed room still registered")
	}
	if got := real.chatRooms["b"]; got != b {
		t.Fatal("other room was removed")
	}
}
