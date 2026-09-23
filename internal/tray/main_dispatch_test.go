package tray

import "testing"

func TestMainQueueSyncHopsWhenOffMain(t *testing.T) {
	q := &mainQueue{isMain: func() bool { return false }}
	q.async = func() { q.drain() }
	ran := 0
	q.syncCall(func() { ran++ })
	if ran != 1 {
		t.Fatalf("ran=%d", ran)
	}
}

func TestMainQueueSyncInlineOnMainDoesNotReenter(t *testing.T) {
	onMain := false
	q := &mainQueue{isMain: func() bool { return onMain }}
	nested := false
	hopped := 0
	q.async = func() {
		hopped++
		onMain = true
		q.drain()
		onMain = false
	}
	q.syncCall(func() {
		q.syncCall(func() { nested = true })
	})
	if !nested {
		t.Fatal("nested main-thread call did not run")
	}
	if hopped != 1 {
		t.Fatalf("hops=%d", hopped)
	}
}

func TestMainQueueAsyncDrainFromAnotherGoroutine(t *testing.T) {
	q := &mainQueue{isMain: func() bool { return false }}
	q.async = func() { go q.drain() }
	done := make(chan struct{})
	q.asyncCall(func() { close(done) })
	<-done
}
