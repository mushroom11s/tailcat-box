package adapter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	if opts.IdentityJSON != "" {
		sum := sha256.Sum256([]byte(opts.IdentityJSON))
		suffix := hex.EncodeToString(sum[:6])
		addr = "tc:fake-ssh-desk-" + suffix
		if opts.NoAuth {
			addr = "tc:fake-noauth-ssh-desk-" + suffix
		}
	}
	gate := sshGate{allowAny: opts.AllowAny}
	if opts.RestrictClients && !opts.AllowAny {
		gate.restrict = true
		gate.keys = map[string]bool{}
		for _, key := range opts.AllowedNodeKeys {
			key = strings.TrimSpace(key)
			if key != "" {
				gate.keys[key] = true
			}
		}
	}
	f.mu.Lock()
	f.sshGates[addr] = gate
	f.mu.Unlock()
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
	var stop chan struct{}
	var input chan string
	var fan *sshFan
	if opts.Interactive {
		stop = f.track(sessionID)
		input = make(chan string, 8)
		fan = newSSHFan()
		f.mu.Lock()
		f.sshInput[sessionID] = input
		f.sshFan[sessionID] = fan
		f.mu.Unlock()
	}
	go func() {
		defer close(ch)
		if opts.Interactive {
			defer f.untrack(sessionID)
			defer fan.close()
		}
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
		if !f.sshAllowed(serverAddr, opts.ClientNodeKey) {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "peer is not on the SSH allowlist"}
			return
		}
		if opts.Interactive {
			ch <- Event{SessionID: sessionID, Kind: EventReady, Address: serverAddr}
			chunk := "connected\r\n"
			fan.publish([]byte(chunk))
			ch <- Event{SessionID: sessionID, Kind: EventData, Data: chunk}
			for {
				select {
				case <-ctx.Done():
					ch <- Event{SessionID: sessionID, Kind: EventClosed}
					return
				case <-stop:
					ch <- Event{SessionID: sessionID, Kind: EventClosed}
					return
				case line := <-input:
					fan.publish([]byte(line))
					ch <- Event{SessionID: sessionID, Kind: EventData, Data: line}
				}
			}
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

func (f *Fake) sshAllowed(addr, clientKey string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	gate, ok := f.sshGates[addr]
	if !ok || !gate.restrict || gate.allowAny {
		return true
	}
	return gate.keys[strings.TrimSpace(clientKey)]
}

func (f *Fake) WriteSSH(sessionID string, data string) error {
	f.mu.Lock()
	ch := f.sshInput[sessionID]
	f.mu.Unlock()
	if ch == nil {
		return fmt.Errorf("ssh session is not interactive")
	}
	select {
	case ch <- data:
		return nil
	default:
		return fmt.Errorf("ssh session is not accepting input")
	}
}

func (f *Fake) SubscribeSSH(sessionID string) (<-chan []byte, func(), error) {
	f.mu.Lock()
	fan := f.sshFan[sessionID]
	f.mu.Unlock()
	if fan == nil {
		return nil, nil, fmt.Errorf("ssh session is not interactive")
	}
	ch, cancel := fan.subscribe()
	return ch, cancel, nil
}

func (f *Fake) NodeKeyFromAddr(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("address is required")
	}
	if strings.HasPrefix(raw, "nodekey:") {
		if strings.TrimPrefix(raw, "nodekey:") == "" {
			return "", fmt.Errorf("invalid node key")
		}
		return raw, nil
	}
	if strings.HasPrefix(raw, "tc:") {
		return "nodekey:" + raw, nil
	}
	return "", fmt.Errorf("invalid tailcat address")
}

func (f *Fake) PublicNodeKey(identityJSON string) (string, error) {
	var rec struct {
		Fake string `json:"fake"`
	}
	if err := json.Unmarshal([]byte(identityJSON), &rec); err != nil || rec.Fake == "" {
		return "", fmt.Errorf("ssh identity is missing a node key")
	}
	return "nodekey:" + rec.Fake, nil
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
