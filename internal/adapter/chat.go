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
	Close() error
}

type ChatAdapter interface {
	StartRoom(ctx context.Context, opts RoomOpts) (Room, error)
}
