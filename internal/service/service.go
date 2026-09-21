package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/mushroom11s/tailcat-desktop-client/internal/adapter"
	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
)

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

func (s *Service) StartPipeServe() (session.Session, error) {
	sess := session.New(session.KindPipeServe)

	s.mu.Lock()
	s.sessions[sess.ID] = sess
	ctx, cancel := context.WithCancel(context.Background())
	s.cancels[sess.ID] = cancel
	s.mu.Unlock()

	ch, err := s.ad.StartPipeServe(ctx, sess.ID)
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

func (s *Service) DialPipe(addr string, payload string) (session.Session, error) {
	sess := session.New(session.KindPipeDial)
	sess.Address = addr

	s.mu.Lock()
	s.sessions[sess.ID] = sess
	ctx, cancel := context.WithCancel(context.Background())
	s.cancels[sess.ID] = cancel
	s.mu.Unlock()

	ch, err := s.ad.DialPipe(ctx, sess.ID, addr, payload)
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
