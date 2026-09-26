package adapter

import "context"

type RoomOpts struct {
	SessionID      string
	PrivateKeyJSON string
	Region         string
	DERPMapURL     string
}

type ChatEventKind string

const (
	ChatEventReady   ChatEventKind = "ready"
	ChatEventInbound ChatEventKind = "inbound"
	ChatEventClosed  ChatEventKind = "closed"
)

type ChatEvent struct {
	SessionID string
	Kind      ChatEventKind
	Address   string
	Port      uint16
	Data      []byte
	Err       string
}

type Room interface {
	SessionID() string
	Address() string
	SetPeer(addr string) error
	SendEnvelope(ctx context.Context, port uint16, frame []byte) error
	Events() <-chan ChatEvent
	// WatchPeerPath reports the session path to peer until ctx ends.
	// It returns immediately. The first value is checking, before any probe.
	// Later values are derp or direct, including an upgrade from derp to direct.
	// This is the current path to the peer, not a per-byte guarantee.
	WatchPeerPath(ctx context.Context, peer string) <-chan PeerPath
	Close() error
}

type ChatAdapter interface {
	StartRoom(ctx context.Context, opts RoomOpts) (Room, error)
}
