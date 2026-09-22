package adapter_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
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

func TestFakeRecvReadyAndDrop(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ch, err := f.StartRecv(ctx, "r1", t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-ch:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		want := "tc:fake-recv-r1"
		if ev.Address != want {
			t.Fatalf("address=%q want=%q", ev.Address, want)
		}
	case <-ctx.Done():
		t.Fatal("timeout ready")
	}
	select {
	case ev := <-ch:
		if ev.Kind != adapter.EventData {
			t.Fatalf("drop event=%+v", ev)
		}
		if ev.Data == "" {
			t.Fatal("expected drop notification")
		}
	case <-ctx.Done():
		t.Fatal("timeout drop")
	}
}

func TestFakeFilesServeAndListAndCopy(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	serveCh, err := f.StartFilesServe(ctx, "fs1", t.TempDir(), adapter.FilesServeOpts{})
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
		if addr != "tc:fake-files-fs1" {
			t.Fatalf("address=%q", addr)
		}
	case <-ctx.Done():
		t.Fatal("timeout ready")
	}

	entries, err := f.ListRemote(ctx, addr, ".")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 2 {
		t.Fatalf("entries=%+v", entries)
	}
	var sawFile, sawDir bool
	for _, e := range entries {
		if e.Name == "hello.txt" && !e.IsDir {
			sawFile = true
		}
		if e.Name == "photos" && e.IsDir {
			sawDir = true
		}
	}
	if !sawFile || !sawDir {
		t.Fatalf("entries=%+v", entries)
	}

	copyCh, err := f.StartCopy(ctx, "c1", addr, []string{"/tmp/a.txt"}, ".")
	if err != nil {
		t.Fatal(err)
	}
	events := collectUntilClosed(t, ctx, copyCh)
	var progress bool
	var closed bool
	for _, ev := range events {
		if ev.Kind == adapter.EventData && ev.Data != "" {
			progress = true
		}
		if ev.Kind == adapter.EventClosed {
			closed = true
		}
	}
	if !progress || !closed {
		t.Fatalf("copy events=%+v", events)
	}
}

func TestFakeListRemoteUnknownServe(t *testing.T) {
	f := adapter.NewFake()
	if _, err := f.ListRemote(context.Background(), "tc:unknown", "."); err == nil {
		t.Fatal("expected error")
	}
}

func TestFakeSSHServeKeyedAndNoAuth(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ch, err := f.StartSSHServe(ctx, "ssh1", adapter.SSHServeOpts{AuthorizedKeys: "ssh-ed25519 AAAA test"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-ch:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		if ev.Address != "tc:fake-ssh-ssh1" {
			t.Fatalf("address=%q", ev.Address)
		}
	case <-ctx.Done():
		t.Fatal("timeout keyed")
	}

	noAuthCh, err := f.StartSSHServe(ctx, "ssh2", adapter.SSHServeOpts{NoAuth: true})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-noAuthCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		if ev.Address != "tc:fake-noauth-ssh-ssh2" {
			t.Fatalf("address=%q", ev.Address)
		}
	case <-ctx.Done():
		t.Fatal("timeout no-auth")
	}
}

func TestFakeSSHClientAgainstServe(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	serveCh, err := f.StartSSHServe(ctx, "ssh1", adapter.SSHServeOpts{NoAuth: true})
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
		t.Fatal("timeout serve")
	}

	clientCh, err := f.StartSSHClient(ctx, "c1", addr, adapter.SSHClientOpts{Command: "whoami"})
	if err != nil {
		t.Fatal(err)
	}
	events := collectUntilClosed(t, ctx, clientCh)
	var data string
	var closed bool
	for _, ev := range events {
		if ev.Kind == adapter.EventData {
			data = ev.Data
		}
		if ev.Kind == adapter.EventClosed {
			closed = true
		}
	}
	if !strings.Contains(data, "whoami") {
		t.Fatalf("data=%q events=%+v", data, events)
	}
	if !closed {
		t.Fatalf("events=%+v", events)
	}

	if _, err := f.StartSSHClient(ctx, "c2", "tc:unknown", adapter.SSHClientOpts{}); err != nil {
		t.Fatal(err)
	}
}

func TestFakeSOCKSExitExecAndNetworkOpts(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	f.SetNetworkOpts(adapter.NetworkOpts{Region: "nyc", DERPMapURL: "https://example.test/derpmap.json"})
	got := f.NetworkOpts()
	if got.Region != "nyc" || got.DERPMapURL == "" {
		t.Fatalf("%+v", got)
	}

	exitCh, err := f.StartExitNode(ctx, "e1")
	if err != nil {
		t.Fatal(err)
	}
	var exitAddr string
	select {
	case ev := <-exitCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		exitAddr = ev.Address
		if exitAddr != "tc:fake-exit-e1" {
			t.Fatalf("address=%q", exitAddr)
		}
	case <-ctx.Done():
		t.Fatal("timeout exit")
	}

	socksCh, err := f.StartSOCKS(ctx, "s1", exitAddr, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-socksCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		if !strings.HasPrefix(ev.Address, "socks5h://") {
			t.Fatalf("socks addr=%q", ev.Address)
		}
	case <-ctx.Done():
		t.Fatal("timeout socks")
	}

	execCh, err := f.StartExec(ctx, "x1", []string{"/bin/echo", "hi"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-execCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		if ev.Address != "tc:fake-exec-x1" {
			t.Fatalf("address=%q", ev.Address)
		}
	case <-ctx.Done():
		t.Fatal("timeout exec")
	}
}
