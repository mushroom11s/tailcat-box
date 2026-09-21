package adapter

import (
	"context"
	"fmt"
	"io"
	"net"
	"runtime/debug"
	"sync"
	"time"

	"github.com/tailscale/tailcat"
)

// PipePort is the TCP port used by the official CLI stdin/stdout pipe.
// Bare `tailcat <addr>` dials this port.
const PipePort uint16 = 1

const maxPipeBytes = 1 << 20

// Real embeds github.com/tailscale/tailcat for Plan 1 pipe serve and dial.
type Real struct {
	mu     sync.Mutex
	serves map[string]*serveRun
	dials  map[string]context.CancelFunc
}

type serveRun struct {
	server *tailcat.Server
	stop   chan struct{}
}

func NewReal() *Real {
	return &Real{
		serves: make(map[string]*serveRun),
		dials:  make(map[string]context.CancelFunc),
	}
}

// Version returns the pinned github.com/tailscale/tailcat module version.
func (r *Real) Version() string {
	return TailcatVersion()
}

// TailcatVersion reports the compiled github.com/tailscale/tailcat module version.
func TailcatVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, d := range info.Deps {
		if d.Path == "github.com/tailscale/tailcat" && d.Version != "" {
			return d.Version
		}
	}
	return "unknown"
}

func (r *Real) StartPipeServe(ctx context.Context, sessionID string) (<-chan Event, error) {
	ch := make(chan Event, 16)
	stop := make(chan struct{})

	r.mu.Lock()
	if existing, ok := r.serves[sessionID]; ok {
		close(existing.stop)
		if existing.server != nil {
			_ = existing.server.Close()
		}
	}
	run := &serveRun{stop: stop}
	r.serves[sessionID] = run
	r.mu.Unlock()

	go r.runPipeServe(ctx, sessionID, run, ch)
	return ch, nil
}

func (r *Real) runPipeServe(ctx context.Context, sessionID string, run *serveRun, ch chan Event) {
	var sendMu sync.Mutex
	closed := false
	send := func(ev Event) {
		sendMu.Lock()
		defer sendMu.Unlock()
		if closed {
			return
		}
		select {
		case ch <- ev:
		default:
		}
	}
	finish := func(ev Event) {
		sendMu.Lock()
		defer sendMu.Unlock()
		if closed {
			return
		}
		select {
		case ch <- ev:
		default:
		}
		closed = true
		close(ch)
	}
	defer func() {
		r.mu.Lock()
		if current, ok := r.serves[sessionID]; ok && current == run {
			delete(r.serves, sessionID)
		}
		r.mu.Unlock()
		finish(Event{SessionID: sessionID, Kind: EventClosed})
	}()

	srv := &tailcat.Server{
		Logf: func(string, ...any) {},
		OnTCP: func(port uint16) func(net.Conn) {
			if port != PipePort {
				return nil
			}
			return func(c net.Conn) {
				defer c.Close()
				data, err := io.ReadAll(io.LimitReader(c, maxPipeBytes))
				if len(data) > 0 {
					send(Event{SessionID: sessionID, Kind: EventData, Data: string(data)})
					_, _ = c.Write(data)
				}
				if err != nil && err != io.EOF && len(data) == 0 {
					send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
				}
			}
		},
	}
	if err := srv.Start(); err != nil {
		send(Event{SessionID: sessionID, Kind: EventError, Err: err.Error()})
		return
	}

	r.mu.Lock()
	run.server = srv
	r.mu.Unlock()

	send(Event{
		SessionID: sessionID,
		Kind:      EventReady,
		Address:   string(srv.TailcatAddr()),
	})

	select {
	case <-ctx.Done():
	case <-run.stop:
	}
	_ = srv.Close()
}

func (r *Real) DialPipe(ctx context.Context, sessionID string, addr string, payload string) (<-chan Event, error) {
	ch := make(chan Event, 8)
	ctx, cancel := context.WithCancel(ctx)

	r.mu.Lock()
	if prev, ok := r.dials[sessionID]; ok {
		prev()
	}
	r.dials[sessionID] = cancel
	r.mu.Unlock()

	go func() {
		defer cancel()
		defer close(ch)
		defer func() {
			r.mu.Lock()
			delete(r.dials, sessionID)
			r.mu.Unlock()
		}()

		cl := tailcat.NewClient(tailcat.Addr(addr))
		cl.Logf = func(string, ...any) {}
		defer cl.Close()

		conn, err := cl.DialTCPPort(ctx, PipePort)
		if err != nil {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		defer conn.Close()

		if _, err := io.WriteString(conn, payload); err != nil {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		if cw, ok := conn.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}

		reply, err := io.ReadAll(io.LimitReader(conn, maxPipeBytes))
		if len(reply) > 0 {
			ch <- Event{SessionID: sessionID, Kind: EventData, Data: string(reply)}
		}
		if err != nil && err != io.EOF && len(reply) == 0 {
			ch <- Event{SessionID: sessionID, Kind: EventError, Err: err.Error()}
			return
		}
		ch <- Event{SessionID: sessionID, Kind: EventClosed}
	}()

	return ch, nil
}

func (r *Real) StartPortServe(ctx context.Context, sessionID string, mappings []PortMapping) (<-chan Event, error) {
	return nil, fmt.Errorf("StartPortServe not implemented")
}

func (r *Real) StartForward(ctx context.Context, sessionID string, serverAddr string, mappings []PortMapping) (<-chan Event, error) {
	return nil, fmt.Errorf("StartForward not implemented")
}

func (r *Real) StartBrowse(ctx context.Context, sessionID string, serverAddr string) (<-chan Event, error) {
	return nil, fmt.Errorf("StartBrowse not implemented")
}

func (r *Real) StartPing(ctx context.Context, sessionID string, addr string, untilDirect bool, timeout time.Duration) (<-chan Event, error) {
	return nil, fmt.Errorf("StartPing not implemented")
}

func (r *Real) Stop(sessionID string) error {
	r.mu.Lock()
	run, ok := r.serves[sessionID]
	if ok {
		delete(r.serves, sessionID)
	}
	cancel, dialing := r.dials[sessionID]
	if dialing {
		delete(r.dials, sessionID)
	}
	r.mu.Unlock()

	if ok {
		select {
		case <-run.stop:
		default:
			close(run.stop)
		}
		if run.server != nil {
			_ = run.server.Close()
		}
	}
	if dialing && cancel != nil {
		cancel()
	}
	return nil
}
