package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
)

const maxChatFrame = 1 << 20

type realRoom struct {
	real   *Real
	srv    *tailcat.Server
	id     string
	addr   string
	peer   string
	events chan ChatEvent
	cancel context.CancelFunc
	once   sync.Once
	mu     sync.Mutex
	done   bool
}

func (r *Real) StartRoom(ctx context.Context, opts RoomOpts) (Room, error) {
	if opts.SessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	ctx, cancel := context.WithCancel(ctx)
	room := &realRoom{
		real:   r,
		id:     opts.SessionID,
		events: make(chan ChatEvent, 16),
		cancel: cancel,
	}
	srv := &tailcat.Server{Logf: func(string, ...any) {}}
	if err := applyRoomKey(srv, opts.PrivateKeyJSON); err != nil {
		cancel()
		return nil, err
	}
	netOpts := r.NetworkOpts()
	if opts.Region != "" || opts.DERPMapURL != "" {
		netOpts = NetworkOpts{Region: opts.Region, DERPMapURL: opts.DERPMapURL}
	}
	if netOpts.DERPMapURL != "" {
		srv.DERPMapURL = netOpts.DERPMapURL
	}
	if rid := r.resolveRegionID(ctx, netOpts); rid != 0 {
		srv.RegionID = tailcfg.DERPRegionID(rid)
	}
	srv.OnTCP = func(port uint16) func(net.Conn) {
		switch port {
		case 1, 100, 101, 102, 103:
		default:
			return nil
		}
		return func(c net.Conn) {
			defer c.Close()
			data, _ := io.ReadAll(io.LimitReader(c, maxChatFrame))
			room.emit(ChatEvent{SessionID: room.id, Kind: ChatEventInbound, Port: port, Data: data})
		}
	}
	if err := srv.Start(); err != nil {
		cancel()
		return nil, err
	}
	room.srv = srv
	room.addr = string(srv.TailcatAddr())
	r.mu.Lock()
	if r.chat != nil {
		old := r.chat
		r.chat = nil
		r.mu.Unlock()
		_ = old.Close()
		r.mu.Lock()
	}
	r.chat = room
	r.mu.Unlock()
	room.emit(ChatEvent{SessionID: room.id, Kind: ChatEventReady, Address: room.addr})
	go func() {
		<-ctx.Done()
		_ = room.Close()
	}()
	return room, nil
}

func applyRoomKey(srv *tailcat.Server, keyJSON string) error {
	if keyJSON == "" {
		return nil
	}
	var pk tailcat.PrivateKey
	if err := json.Unmarshal([]byte(keyJSON), &pk); err != nil || pk.Private.IsZero() {
		return fmt.Errorf("saved key is not a Tailcat private key")
	}
	srv.Key = pk.Private
	var zero tailcat.PresharedKey
	if pk.Public.PresharedKey != zero {
		srv.PresharedKey = pk.Public.PresharedKey
	}
	return nil
}

func (r *realRoom) emit(ev ChatEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return
	}
	select {
	case r.events <- ev:
	default:
	}
}

func (r *realRoom) SessionID() string { return r.id }
func (r *realRoom) Address() string   { return r.addr }
func (r *realRoom) Events() <-chan ChatEvent {
	return r.events
}

func (r *realRoom) SetPeer(addr string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return fmt.Errorf("room closed")
	}
	r.peer = addr
	return nil
}

func (r *realRoom) SendEnvelope(ctx context.Context, port uint16, frame []byte) error {
	r.mu.Lock()
	peer := r.peer
	done := r.done
	r.mu.Unlock()
	if done {
		return fmt.Errorf("room closed")
	}
	if peer == "" {
		return fmt.Errorf("no peer")
	}
	cl := r.real.newClient(peer)
	defer cl.Close()
	conn, err := cl.DialTCPPort(ctx, port)
	if err != nil {
		return err
	}
	return writeAndHalfClose(conn, frame)
}

func (r *realRoom) Close() error {
	r.once.Do(func() {
		r.mu.Lock()
		r.done = true
		srv := r.srv
		r.srv = nil
		r.mu.Unlock()
		r.cancel()
		if srv != nil {
			_ = srv.Close()
		}
		r.real.mu.Lock()
		if r.real.chat == r {
			r.real.chat = nil
		}
		r.real.mu.Unlock()
		close(r.events)
	})
	return nil
}

var _ ChatAdapter = (*Real)(nil)
