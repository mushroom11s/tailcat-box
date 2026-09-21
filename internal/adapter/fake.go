package adapter

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

type Fake struct {
	mu    sync.Mutex
	stops map[string]chan struct{}
	ports map[string]string // sessionID -> tc:fake-port-<id>
}

func NewFake() *Fake {
	return &Fake{
		stops: make(map[string]chan struct{}),
		ports: make(map[string]string),
	}
}

func (f *Fake) track(sessionID string) chan struct{} {
	stop := make(chan struct{})
	f.mu.Lock()
	f.stops[sessionID] = stop
	f.mu.Unlock()
	return stop
}

func (f *Fake) untrack(sessionID string) {
	f.mu.Lock()
	delete(f.stops, sessionID)
	delete(f.ports, sessionID)
	f.mu.Unlock()
}

func (f *Fake) waitStop(ctx context.Context, stop <-chan struct{}) {
	select {
	case <-ctx.Done():
	case <-stop:
	}
}

func (f *Fake) StartPipeServe(ctx context.Context, sessionID string) (<-chan Event, error) {
	ch := make(chan Event, 4)
	stop := f.track(sessionID)

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

		ch <- Event{
			SessionID: sessionID,
			Kind:      EventReady,
			Address:   "tc:fake-" + sessionID,
		}

		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()

	return ch, nil
}

func (f *Fake) DialPipe(ctx context.Context, sessionID string, addr string, payload string) (<-chan Event, error) {
	ch := make(chan Event, 4)

	go func() {
		defer close(ch)

		select {
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: ctx.Err().Error()}
			return
		default:
		}

		if !strings.HasPrefix(addr, "tc:fake-") {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "invalid address"}
			return
		}

		ch <- Event{
			SessionID: sessionID,
			Kind:      EventData,
			Data:      "echo:" + payload,
		}
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()

	return ch, nil
}

func (f *Fake) StartPortServe(ctx context.Context, sessionID string, mappings []PortMapping) (<-chan Event, error) {
	ch := make(chan Event, 4)
	stop := f.track(sessionID)
	addr := "tc:fake-port-" + sessionID

	f.mu.Lock()
	f.ports[sessionID] = addr
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

		_ = mappings
		ch <- Event{
			SessionID: sessionID,
			Kind:      EventReady,
			Address:   addr,
		}

		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()

	return ch, nil
}

func (f *Fake) knownPortServe(addr string) bool {
	if !strings.HasPrefix(addr, "tc:fake-port-") {
		return false
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, served := range f.ports {
		if served == addr {
			return true
		}
	}
	return false
}

func (f *Fake) StartForward(ctx context.Context, sessionID string, serverAddr string, mappings []PortMapping) (<-chan Event, error) {
	ch := make(chan Event, 4)
	stop := f.track(sessionID)

	go func() {
		defer close(ch)
		defer f.untrack(sessionID)

		if !f.knownPortServe(serverAddr) {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "unknown fake serve"}
			return
		}

		listen := "127.0.0.1:0"
		if len(mappings) > 0 && mappings[0].LocalPort != 0 {
			listen = fmt.Sprintf("127.0.0.1:%d", mappings[0].LocalPort)
		}
		ch <- Event{SessionID: sessionID, Kind: EventReady, Address: listen}
		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()

	return ch, nil
}

func (f *Fake) StartBrowse(ctx context.Context, sessionID string, serverAddr string) (<-chan Event, error) {
	ch := make(chan Event, 4)
	stop := f.track(sessionID)

	go func() {
		defer close(ch)
		defer f.untrack(sessionID)

		if !f.knownPortServe(serverAddr) {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: "unknown fake serve"}
			return
		}

		url := "http://127.0.0.1:18080/"
		ch <- Event{SessionID: sessionID, Kind: EventReady, Address: url, Data: url}
		f.waitStop(ctx, stop)
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()

	return ch, nil
}

func (f *Fake) StartPing(ctx context.Context, sessionID string, addr string, untilDirect bool, timeout time.Duration) (<-chan Event, error) {
	ch := make(chan Event, 8)

	go func() {
		defer close(ch)
		_ = untilDirect
		_ = timeout
		_ = addr
		select {
		case <-ctx.Done():
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: ctx.Err().Error()}
			return
		default:
		}
		ch <- Event{SessionID: sessionID, Kind: EventData, Data: "pong in 12ms via DERP(nyc)"}
		ch <- Event{SessionID: sessionID, Kind: EventData, Data: "pong in 4ms via direct"}
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()

	return ch, nil
}

func (f *Fake) ParseAddr(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("address is required")
	}
	return fmt.Sprintf(`{"fake":true,"addr":%q}`, raw), nil
}

func (f *Fake) ResolveAddr(ctx context.Context, raw string) (string, error) {
	_ = ctx
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("address is required")
	}
	return "tc:fake-resolved", nil
}

func (f *Fake) Stop(sessionID string) error {
	f.mu.Lock()
	stop, ok := f.stops[sessionID]
	if ok {
		delete(f.stops, sessionID)
	}
	f.mu.Unlock()

	if ok {
		select {
		case <-stop:
		default:
			close(stop)
		}
	}
	return nil
}
