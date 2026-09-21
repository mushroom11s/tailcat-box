package service

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
)

const defaultPingTimeout = 10 * time.Second

type Service struct {
	ad       adapter.TailcatAdapter
	mu       sync.Mutex
	sessions map[string]*session.Session
	cancels  map[string]context.CancelFunc
	events   chan adapter.Event
}

func New(ad adapter.TailcatAdapter) *Service {
	return &Service{
		ad:       ad,
		sessions: make(map[string]*session.Session),
		cancels:  make(map[string]context.CancelFunc),
		events:   make(chan adapter.Event, 64),
	}
}

func (s *Service) start(kind session.Kind, addr string, run func(ctx context.Context, id string) (<-chan adapter.Event, error)) (session.Session, error) {
	sess := session.New(kind)
	sess.Address = addr

	s.mu.Lock()
	s.sessions[sess.ID] = sess
	ctx, cancel := context.WithCancel(context.Background())
	s.cancels[sess.ID] = cancel
	s.mu.Unlock()

	ch, err := run(ctx, sess.ID)
	if err != nil {
		cancel()
		s.mu.Lock()
		delete(s.sessions, sess.ID)
		delete(s.cancels, sess.ID)
		s.mu.Unlock()
		return session.Session{}, err
	}

	go s.consume(sess.ID, ch)
	return *sess, nil
}

func (s *Service) StartPipeServe() (session.Session, error) {
	return s.start(session.KindPipeServe, "", func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartPipeServe(ctx, id)
	})
}

func (s *Service) DialPipe(addr string, payload string) (session.Session, error) {
	return s.start(session.KindPipeDial, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.DialPipe(ctx, id, addr, payload)
	})
}

func (s *Service) StartPortServe(mappings []adapter.PortMapping) (session.Session, error) {
	return s.start(session.KindPortServe, "", func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartPortServe(ctx, id, mappings)
	})
}

func (s *Service) StartForward(addr string, mappings []adapter.PortMapping) (session.Session, error) {
	return s.start(session.KindForward, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartForward(ctx, id, addr, mappings)
	})
}

func (s *Service) StartBrowse(addr string) (session.Session, error) {
	return s.start(session.KindBrowse, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartBrowse(ctx, id, addr)
	})
}

func (s *Service) StartPing(addr string, untilDirect bool) (session.Session, error) {
	return s.start(session.KindPing, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartPing(ctx, id, addr, untilDirect, defaultPingTimeout)
	})
}

func (s *Service) ParseAddr(raw string) (string, error) {
	return s.ad.ParseAddr(raw)
}

func (s *Service) ResolveAddr(raw string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return s.ad.ResolveAddr(ctx, raw)
}

func (s *Service) Stop(sessionID string) error {
	s.mu.Lock()
	sess, ok := s.sessions[sessionID]
	cancel := s.cancels[sessionID]
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("unknown session %s", sessionID)
	}

	if cancel != nil {
		cancel()
	}
	if err := s.ad.Stop(sessionID); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if sess.Status != session.StatusStopped {
		_ = sess.Transition(session.StatusStopped)
	}
	delete(s.cancels, sessionID)
	return nil
}

func (s *Service) List() []session.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]session.Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		out = append(out, *sess)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.Before(out[j].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (s *Service) Events() <-chan adapter.Event {
	return s.events
}

func (s *Service) consume(sessionID string, ch <-chan adapter.Event) {
	for ev := range ch {
		s.applyEvent(ev)
		select {
		case s.events <- ev:
		default:
			// drop if consumers are not keeping up
		}
	}
}

func (s *Service) applyEvent(ev adapter.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sess, ok := s.sessions[ev.SessionID]
	if !ok {
		return
	}

	switch ev.Kind {
	case adapter.EventReady:
		sess.Address = ev.Address
		_ = sess.Transition(session.StatusRunning)
	case adapter.EventError:
		sess.Err = ev.Err
		_ = sess.Transition(session.StatusError)
	case adapter.EventClosed:
		if sess.Status != session.StatusStopped {
			_ = sess.Transition(session.StatusStopped)
		}
	}
}
