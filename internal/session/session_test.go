package session_test

import (
	"testing"

	"github.com/mushroom11s/tailcat-desktop-client/internal/session"
)

func TestNewSessionStartsInStarting(t *testing.T) {
	s := session.New(session.KindPipeServe)
	if s.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if s.Status != session.StatusStarting {
		t.Fatalf("status=%s", s.Status)
	}
}

func TestTransitionStartingToRunning(t *testing.T) {
	s := session.New(session.KindPipeServe)
	if err := s.Transition(session.StatusRunning); err != nil {
		t.Fatal(err)
	}
	if s.Status != session.StatusRunning {
		t.Fatalf("status=%s", s.Status)
	}
}

func TestTransitionRejectsStoppedToRunning(t *testing.T) {
	s := session.New(session.KindPipeServe)
	_ = s.Transition(session.StatusStopped)
	if err := s.Transition(session.StatusRunning); err == nil {
		t.Fatal("expected error")
	}
}
