//go:build integration

package adapter_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
)

func TestRealLoopbackPipe(t *testing.T) {
	r := adapter.NewReal()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	t.Cleanup(func() {
		_ = r.Stop("s1")
		_ = r.Stop("s2")
	})

	serveCh, err := r.StartPipeServe(ctx, "s1")
	if err != nil {
		t.Skipf("StartPipeServe (network/DERP may be blocked): %v", err)
	}

	var addr string
	select {
	case ev := <-serveCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("ready event=%+v", ev)
		}
		addr = ev.Address
	case <-ctx.Done():
		t.Fatal("timeout waiting for EventReady")
	}
	if !strings.HasPrefix(addr, "tc") {
		t.Fatalf("address=%q", addr)
	}

	dialCh, err := r.DialPipe(ctx, "s2", addr, "hello")
	if err != nil {
		t.Fatalf("DialPipe: %v", err)
	}

	gotData := false
	for {
		select {
		case ev, ok := <-dialCh:
			if !ok {
				if !gotData {
					t.Fatal("dial closed without EventData")
				}
				return
			}
			if ev.Kind == adapter.EventError {
				t.Fatalf("dial error: %s", ev.Err)
			}
			if ev.Kind == adapter.EventData {
				if ev.Data != "hello" {
					t.Fatalf("data=%q", ev.Data)
				}
				gotData = true
			}
		case <-ctx.Done():
			t.Fatal("timeout waiting for dial EventData")
		}
	}
}
