package adapter

import (
	"context"
	"time"
)

type EventKind string

const (
	EventReady  EventKind = "ready" // Address set for serve
	EventData   EventKind = "data"  // payload bytes as string for Plan 1 text pipe
	EventError  EventKind = "error"
	EventClosed EventKind = "closed"
)

type Event struct {
	SessionID string
	Kind      EventKind
	Address   string // for EventReady
	Data      string // for EventData
	Err       string // for EventError
}

// PortMapping describes a TCP port mapping.
//
// Zero-value semantics match the Tailcat CLI:
//   - RemoteHost empty means localhost
//   - RemotePort zero means the same port as LocalPort
//   - LocalPort zero on forward/browse asks the OS for a free port
type PortMapping struct {
	LocalPort  uint16
	RemoteHost string
	RemotePort uint16
}

type TailcatAdapter interface {
	// StartPipeServe begins an ephemeral server; emits EventReady with Address, then EventData/Closed/Error.
	StartPipeServe(ctx context.Context, sessionID string) (<-chan Event, error)
	// DialPipe connects to addr and writes payload; emits EventData for any reply optional; then EventClosed.
	DialPipe(ctx context.Context, sessionID string, addr string, payload string) (<-chan Event, error)
	// StartPortServe advertises TCP ports / mappings and emits EventReady with the serve address.
	StartPortServe(ctx context.Context, sessionID string, mappings []PortMapping) (<-chan Event, error)
	// StartForward listens locally and forwards to serverAddr using mappings.
	StartForward(ctx context.Context, sessionID string, serverAddr string, mappings []PortMapping) (<-chan Event, error)
	// StartBrowse local-forwards remote port 80 then signals ready with a local URL in Event.Address or Event.Data.
	StartBrowse(ctx context.Context, sessionID string, serverAddr string) (<-chan Event, error)
	// StartPing emits EventData pong lines and EventClosed when done.
	StartPing(ctx context.Context, sessionID string, addr string, untilDirect bool, timeout time.Duration) (<-chan Event, error)
	Stop(sessionID string) error
}
