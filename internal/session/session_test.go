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

func TestPlan2SessionKinds(t *testing.T) {
	kinds := []session.Kind{
		session.KindPortServe,
		session.KindForward,
		session.KindBrowse,
		session.KindPing,
	}
	for _, kind := range kinds {
		s := session.New(kind)
		if s.Kind != kind {
			t.Fatalf("kind=%s want=%s", s.Kind, kind)
		}
		if s.Status != session.StatusStarting {
			t.Fatalf("%s status=%s", kind, s.Status)
		}
		if err := s.Transition(session.StatusRunning); err != nil {
			t.Fatalf("%s running: %v", kind, err)
		}
		if err := s.Transition(session.StatusStopped); err != nil {
			t.Fatalf("%s stopped: %v", kind, err)
		}
	}
}
