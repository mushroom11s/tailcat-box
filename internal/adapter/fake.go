package adapter

import (
	"context"
	"strings"
	"sync"
	"time"
)

type Fake struct {
	mu      sync.Mutex
	serves  map[string]chan struct{} // sessionID -> stop signal
}

func NewFake() *Fake {
	return &Fake{
		serves: make(map[string]chan struct{}),
	}
}

func (f *Fake) StartPipeServe(ctx context.Context, sessionID string) (<-chan Event, error) {
	ch := make(chan Event, 4)
	stop := make(chan struct{})

	f.mu.Lock()
	f.serves[sessionID] = stop
	f.mu.Unlock()

	go func() {
		defer close(ch)
		defer func() {
			f.mu.Lock()
			delete(f.serves, sessionID)
			f.mu.Unlock()
		}()

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

		select {
		case <-ctx.Done():
		case <-stop:
		}
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

func (f *Fake) Stop(sessionID string) error {
	f.mu.Lock()
	stop, ok := f.serves[sessionID]
	if ok {
		delete(f.serves, sessionID)
	}
	f.mu.Unlock()

	if ok {
		close(stop)
	}
	return nil
}
