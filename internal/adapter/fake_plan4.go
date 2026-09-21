package adapter

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (f *Fake) SetNetworkOpts(opts NetworkOpts) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.netOpts = opts
}

func (f *Fake) NetworkOpts() NetworkOpts {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.netOpts
}

func (f *Fake) StartSSHServe(ctx context.Context, sessionID string, opts SSHServeOpts) (<-chan Event, error) {
	addr := "tc:fake-ssh-" + sessionID
	if opts.NoAuth {
		addr = "tc:fake-noauth-ssh-" + sessionID
	}
	return f.startPeer(ctx, sessionID, addr)
}

func (f *Fake) StartExitNode(ctx context.Context, sessionID string) (<-chan Event, error) {
	return f.startPeer(ctx, sessionID, "tc:fake-exit-"+sessionID)
}

func (f *Fake) StartExec(ctx context.Context, sessionID string, argv []string) (<-chan Event, error) {
	_ = argv
	return f.startPeer(ctx, sessionID, "tc:fake-exec-"+sessionID)
}

func (f *Fake) startPeer(ctx context.Context, sessionID, addr string) (<-chan Event, error) {
	ch := make(chan Event, 4)
	stop := f.track(sessionID)
	f.mu.Lock()
	f.peers[sessionID] = addr
	f.mu.Unlock()

	go func() {
		defer close(ch)
		defer f.untrack(sessionID)
		select {
		case <-time.After(10 * time.Millisecond):
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		case <-stop:
			ch <- Event{SessionID: sessionID, Kind: EventClosed}
			return
		}
		ch <- Event{SessionID: sessionID, Kind: EventReady, Address: addr}
		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}

func (f *Fake) knownPeer(addr string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, served := range f.peers {
		if served == addr {
			return true
		}
	}
	return false
}

func (f *Fake) StartSSHClient(ctx context.Context, sessionID string, serverAddr string, opts SSHClientOpts) (<-chan Event, error) {
	ch := make(chan Event, 8)
	go func() {
		defer close(ch)
		select {
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: ctx.Err().Error()}
			return
		default:
		}
		if !f.knownPeer(serverAddr) || !(strings.HasPrefix(serverAddr, "tc:fake-ssh-") || strings.HasPrefix(serverAddr, "tc:fake-noauth-ssh-")) {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "unknown fake ssh serve"}
			return
		}
		cmd := strings.TrimSpace(opts.Command)
		if cmd == "" {
			cmd = "whoami"
		}
		user := opts.User
		if user == "" {
			user = "tailcat"
		}
		ch <- Event{SessionID: sessionID, Kind: EventData, Data: fmt.Sprintf("ssh %s@%s: %s", user, serverAddr, cmd)}
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}

func (f *Fake) StartSOCKS(ctx context.Context, sessionID string, serverAddr string, listen string) (<-chan Event, error) {
	ch := make(chan Event, 4)
	stop := f.track(sessionID)
	go func() {
		defer close(ch)
		defer f.untrack(sessionID)
		if !f.knownPeer(serverAddr) && !f.knownPortServe(serverAddr) && !strings.HasPrefix(serverAddr, "tc:fake-exit-") {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "unknown fake serve"}
			return
		}
		if strings.TrimSpace(listen) == "" {
			listen = "127.0.0.1:0"
		}
		addr := "socks5h://" + listen
		if strings.HasSuffix(listen, ":0") {
			addr = "socks5h://127.0.0.1:1080"
		}
		ch <- Event{SessionID: sessionID, Kind: EventReady, Address: addr, Data: addr}
		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()
	return ch, nil
}
