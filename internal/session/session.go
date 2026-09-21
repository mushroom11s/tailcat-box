package session

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

type Kind string

const (
	KindPipeServe Kind = "pipe_serve"
	KindPipeDial  Kind = "pipe_dial"
	KindPortServe Kind = "port_serve"
	KindForward   Kind = "forward"
	KindBrowse    Kind = "browse"
	KindPing      Kind = "ping"
)

type Status string

const (
	StatusStarting Status = "starting"
	StatusRunning  Status = "running"
	StatusError    Status = "error"
	StatusStopped  Status = "stopped"
)

type Session struct {
	ID        string
	Kind      Kind
	Status    Status
	Address   string
	CreatedAt time.Time
	Err       string
}

func New(kind Kind) *Session {
	return &Session{
		ID:        newID(),
		Kind:      kind,
		Status:    StatusStarting,
		CreatedAt: time.Now(),
	}
}

func (s *Session) Transition(next Status) error {
	if !legalTransition(s.Status, next) {
		return fmt.Errorf("illegal transition from %s to %s", s.Status, next)
	}
	s.Status = next
	return nil
}

func legalTransition(from, to Status) bool {
	switch from {
	case StatusStarting:
		return to == StatusRunning || to == StatusError || to == StatusStopped
	case StatusRunning:
		return to == StatusError || to == StatusStopped
	case StatusError:
		return to == StatusStopped
	case StatusStopped:
		return false
	default:
		return false
	}
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
