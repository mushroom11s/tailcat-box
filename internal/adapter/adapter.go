package adapter

import "context"

type EventKind string

const (
	EventReady  EventKind = "ready"  // Address set for serve
	EventData   EventKind = "data"   // payload bytes as string for Plan 1 text pipe
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

type TailcatAdapter interface {
	// StartPipeServe begins an ephemeral server; emits EventReady with Address, then EventData/Closed/Error.
	StartPipeServe(ctx context.Context, sessionID string) (<-chan Event, error)
	// DialPipe connects to addr and writes payload; emits EventData for any reply optional; then EventClosed.
	DialPipe(ctx context.Context, sessionID string, addr string, payload string) (<-chan Event, error)
	Stop(sessionID string) error
}
