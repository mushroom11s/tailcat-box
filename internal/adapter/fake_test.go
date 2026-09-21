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

func collectUntilClosed(t *testing.T, ctx context.Context, ch <-chan adapter.Event) []adapter.Event {
	t.Helper()
	var events []adapter.Event
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return events
			}
			events = append(events, ev)
		case <-ctx.Done():
			t.Fatalf("timeout waiting for channel close; got %+v", events)
		}
	}
}

func TestFakePortServeAddress(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ch, err := f.StartPortServe(ctx, "p1", []adapter.PortMapping{{LocalPort: 8080}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-ch:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		want := "tc:fake-port-p1"
		if ev.Address != want {
			t.Fatalf("address=%q want=%q", ev.Address, want)
		}
	case <-ctx.Done():
		t.Fatal("timeout")
	}
}

func TestFakeForwardAgainstPortServe(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	serveCh, err := f.StartPortServe(ctx, "p1", []adapter.PortMapping{{LocalPort: 8080}})
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

	fwdCh, err := f.StartForward(ctx, "f1", addr, []adapter.PortMapping{{LocalPort: 18080, RemotePort: 8080}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-fwdCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		if ev.Address == "" {
			t.Fatal("expected forward listen address")
		}
	case <-ctx.Done():
		t.Fatal("timeout")
	}

	browseCh, err := f.StartBrowse(ctx, "b1", addr)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-browseCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		if !strings.HasPrefix(ev.Address, "http://") && !strings.HasPrefix(ev.Data, "http://") {
			t.Fatalf("browse ready=%+v", ev)
		}
	case <-ctx.Done():
		t.Fatal("timeout")
	}
}

func TestFakePingEmitsDERPThenDirect(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ch, err := f.StartPing(ctx, "ping1", "tc:fake-port-p1", true, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	events := collectUntilClosed(t, ctx, ch)
	var data []string
	gotClosed := false
	for _, ev := range events {
		switch ev.Kind {
		case adapter.EventData:
			data = append(data, ev.Data)
		case adapter.EventClosed:
			gotClosed = true
		}
	}
	if len(data) != 2 {
		t.Fatalf("data lines=%v", data)
	}
	if !strings.Contains(strings.ToLower(data[0]), "derp") {
		t.Fatalf("first=%q", data[0])
	}
	if !strings.Contains(strings.ToLower(data[1]), "direct") {
		t.Fatalf("second=%q", data[1])
	}
	if !gotClosed {
		t.Fatalf("events=%+v", events)
	}
}

func TestFakeParseAndResolve(t *testing.T) {
	f := adapter.NewFake()
	raw := "tc:example-addr"
	got, err := f.ParseAddr(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, raw) || !strings.Contains(got, "{") {
		t.Fatalf("parse=%q", got)
	}
	resolved, err := f.ResolveAddr(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	if resolved == "" {
		t.Fatal("empty resolve")
	}
	if _, err := f.ParseAddr(""); err == nil {
		t.Fatal("expected empty parse error")
	}
}
