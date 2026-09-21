package adapter_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
)

func TestFakeServeAndDial(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	serveCh, err := f.StartPipeServe(ctx, "s1")
	if err != nil {
		t.Fatal(err)
	}
	var addr string
	select {
	case ev := <-serveCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		addr = ev.Address
	case <-ctx.Done():
		t.Fatal("timeout")
	}

	dialCh, err := f.DialPipe(ctx, "s2", addr, "hello")
	if err != nil {
		t.Fatal(err)
	}
	gotData := false
	for {
		select {
		case ev, ok := <-dialCh:
			if !ok {
				if !gotData {
					t.Fatal("closed without data")
				}
				return
			}
			if ev.Kind == adapter.EventData {
				if !strings.HasPrefix(ev.Data, "echo:hello") {
					t.Fatalf("data=%q", ev.Data)
				}
				gotData = true
			}
		case <-ctx.Done():
			t.Fatal("timeout")
		}
	}
}
