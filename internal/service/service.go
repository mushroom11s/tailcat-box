package service

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
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
	return s.startWith(kind, addr, false, run)
}

func (s *Service) startWith(kind session.Kind, addr string, dangerous bool, run func(ctx context.Context, id string) (<-chan adapter.Event, error)) (session.Session, error) {
	sess := session.New(kind)
	sess.Address = addr
	sess.Dangerous = dangerous

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

func (s *Service) StartForward(addr string, mappings []adapter.PortMapping, openBrowser bool) (session.Session, error) {
	return s.start(session.KindForward, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartForward(ctx, id, addr, mappings, openBrowser)
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

func (s *Service) StartRecv(inboxDir string, acceptDirs bool) (session.Session, error) {
	if err := requireDir(inboxDir, "inbox directory"); err != nil {
		return session.Session{}, err
	}
	return s.start(session.KindRecv, "", func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartRecv(ctx, id, inboxDir, acceptDirs)
	})
}

func (s *Service) StartCopy(addr string, localPaths []string, remotePath string) (session.Session, error) {
	if strings.TrimSpace(addr) == "" {
		return session.Session{}, fmt.Errorf("address is required")
	}
	if len(localPaths) == 0 {
		return session.Session{}, fmt.Errorf("at least one local path is required")
	}
	return s.start(session.KindCopy, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartCopy(ctx, id, addr, localPaths, remotePath)
	})
}

func (s *Service) StartFilesServe(rootDir string, opts adapter.FilesServeOpts) (session.Session, error) {
	if err := requireDir(rootDir, "directory"); err != nil {
		return session.Session{}, err
	}
	return s.start(session.KindFilesServe, "", func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartFilesServe(ctx, id, rootDir, opts)
	})
}

func (s *Service) ListRemote(addr string, path string) ([]adapter.FileEntry, error) {
	if strings.TrimSpace(addr) == "" {
		return nil, fmt.Errorf("address is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return s.ad.ListRemote(ctx, addr, path)
}

func (s *Service) StartSSHServe(opts adapter.SSHServeOpts, confirmDangerous bool) (session.Session, error) {
	if opts.NoAuth {
		if !confirmDangerous {
			return session.Session{}, fmt.Errorf("no-auth SSH requires explicit confirmation: anyone with the address gets a shell")
		}
	} else if strings.TrimSpace(opts.AuthorizedKeys) == "" {
		return session.Session{}, fmt.Errorf("authorized keys are required for keyed SSH (or use no-auth with confirmation)")
	}
	return s.startWith(session.KindSSHServe, "", opts.NoAuth, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartSSHServe(ctx, id, opts)
	})
}

func (s *Service) StartSSHClient(addr string, opts adapter.SSHClientOpts) (session.Session, error) {
	if strings.TrimSpace(addr) == "" {
		return session.Session{}, fmt.Errorf("address is required")
	}
	return s.start(session.KindSSHClient, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartSSHClient(ctx, id, addr, opts)
	})
}

// StartSSHDesk serves Tailcat's built-in no-auth shell. AllowAny is the wide-open
// mode and is marked dangerous. Otherwise RestrictClients is on, including when
// the allowlist is empty.
func (s *Service) StartSSHDesk(opts adapter.SSHServeOpts) (session.Session, error) {
	opts.NoAuth = true
	opts.AuthorizedKeys = ""
	if opts.AllowAny {
		opts.RestrictClients = false
		opts.AllowedNodeKeys = nil
	} else {
		opts.RestrictClients = true
	}
	return s.startWith(session.KindSSHServe, "", opts.AllowAny, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartSSHServe(ctx, id, opts)
	})
}

func (s *Service) WriteSSH(sessionID, data string) error {
	if strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("session is required")
	}
	return s.ad.WriteSSH(sessionID, data)
}

func (s *Service) StartSOCKS(addr string, listen string) (session.Session, error) {
	if strings.TrimSpace(addr) == "" {
		return session.Session{}, fmt.Errorf("address is required")
	}
	return s.start(session.KindSOCKS, addr, func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartSOCKS(ctx, id, addr, listen)
	})
}

func (s *Service) StartExitNode() (session.Session, error) {
	return s.start(session.KindExitNode, "", func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartExitNode(ctx, id)
	})
}

func (s *Service) StartExec(argv []string) (session.Session, error) {
	if len(argv) == 0 || strings.TrimSpace(argv[0]) == "" {
		return session.Session{}, fmt.Errorf("command is required")
	}
	return s.start(session.KindExec, "", func(ctx context.Context, id string) (<-chan adapter.Event, error) {
		return s.ad.StartExec(ctx, id, argv)
	})
}

func (s *Service) SetNetworkOpts(opts adapter.NetworkOpts) {
	s.ad.SetNetworkOpts(opts)
}

func (s *Service) NetworkOpts() adapter.NetworkOpts {
	return s.ad.NetworkOpts()
}

func requireDir(dir, label string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("%s is required", label)
	}
	fi, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("%s is not a directory", label)
	}
	return nil
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
	case adapter.EventData:
		if ev.Data != "" {
			sess.Progress = ev.Data
		}
	case adapter.EventError:
		sess.Err = ev.Err
		_ = sess.Transition(session.StatusError)
	case adapter.EventClosed:
		if sess.Status != session.StatusStopped {
			_ = sess.Transition(session.StatusStopped)
		}
	}
}
