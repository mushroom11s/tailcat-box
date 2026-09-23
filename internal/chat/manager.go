package chat

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
	"github.com/mushroom11s/tailcat-box/internal/session"
)

const DefaultRoomCap = 8

var (
	// ErrRoomCap is the Phase A cap. Close does not exist yet, so the only way under the cap is to quit.
	ErrRoomCap = errors.New("You can keep 8 rooms open. Quit the app to close rooms.")
	// ErrUnknownRoom means the room id is not an open chat room.
	ErrUnknownRoom = errors.New("Unknown room.")
	// ErrKeyInUse means another open room is already listening with that saved key.
	ErrKeyInUse = errors.New("That key is already listening in another room.")
	// ErrNoRoom means restart was asked with no room selected.
	ErrNoRoom = errors.New("There is no room to restart.")
)

type roomSlot struct {
	svc     *Service
	keyName string
	cancel  context.CancelFunc
}

// Manager owns one chat.Service per open room. App holds a manager instead of a single service.
type Manager struct {
	ad          adapter.ChatAdapter
	dataRoot    string
	cap         int
	mu          sync.Mutex
	rooms       map[string]*roomSlot
	order       []string // newest first
	focus       string
	lobby       bool
	busy        int
	pendingKeys map[string]bool
	events      chan adapter.Event
}

func NewManager(ad adapter.ChatAdapter, dataRoot string) *Manager {
	m := &Manager{
		ad:          ad,
		dataRoot:    dataRoot,
		cap:         DefaultRoomCap,
		rooms:       map[string]*roomSlot{},
		pendingKeys: map[string]bool{},
		events:      make(chan adapter.Event, 64),
		lobby:       true,
	}
	sweepDataRoot(dataRoot)
	return m
}

func (m *Manager) Events() <-chan adapter.Event { return m.events }

func (m *Manager) Focus() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.focus
}

func (m *Manager) Lobby() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lobby
}

func (m *Manager) Order() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.order))
	copy(out, m.order)
	return out
}

func (m *Manager) KeyName(id string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	slot := m.rooms[id]
	if slot == nil {
		return "", false
	}
	return slot.keyName, true
}

// Start opens a new room. Empty KeyName is ephemeral. The cap check and the
// reservation are one critical section, and StartRoom runs only after that.
func (m *Manager) Start(opts StartOpts) (session.Session, error) {
	key := strings.TrimSpace(opts.KeyName)
	opts.KeyName = key
	m.mu.Lock()
	if len(m.rooms)+m.busy >= m.cap {
		m.mu.Unlock()
		return session.Session{}, ErrRoomCap
	}
	if key != "" && (m.pendingKeys[key] || m.hasKeyLocked(key)) {
		m.mu.Unlock()
		return session.Session{}, ErrKeyInUse
	}
	m.busy++
	if key != "" {
		m.pendingKeys[key] = true
	}
	m.mu.Unlock()

	svc := New(m.ad)
	if m.dataRoot != "" {
		svc.SetDataRoot(m.dataRoot)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go m.watch(ctx, svc)
	sess, err := svc.Start(opts)
	if err != nil || sess.ID == "" {
		cancel()
		_ = svc.Stop()
		m.releaseStart(key)
		if err == nil {
			err = fmt.Errorf("room did not start")
		}
		return session.Session{}, err
	}

	m.mu.Lock()
	m.busy--
	delete(m.pendingKeys, key)
	m.rooms[sess.ID] = &roomSlot{svc: svc, keyName: key, cancel: cancel}
	m.order = append([]string{sess.ID}, m.order...)
	m.focus = sess.ID
	m.lobby = false
	m.mu.Unlock()
	return sess, nil
}

func (m *Manager) releaseStart(key string) {
	m.mu.Lock()
	m.busy--
	delete(m.pendingKeys, key)
	m.mu.Unlock()
}

func (m *Manager) hasKeyLocked(key string) bool {
	for _, slot := range m.rooms {
		if slot.keyName == key {
			return true
		}
	}
	return false
}

// Restart replaces that room's listener only. The sidebar slot stays in place
// under the new session id. Other rooms are left running.
func (m *Manager) Restart(id string, opts StartOpts) (session.Session, error) {
	key := strings.TrimSpace(opts.KeyName)
	opts.KeyName = key
	m.mu.Lock()
	slot := m.rooms[id]
	if slot == nil {
		m.mu.Unlock()
		return session.Session{}, ErrUnknownRoom
	}
	if key != "" {
		for otherID, other := range m.rooms {
			if otherID != id && other.keyName == key {
				m.mu.Unlock()
				return session.Session{}, ErrKeyInUse
			}
		}
	}
	svc := slot.svc
	m.mu.Unlock()

	sess, err := svc.Restart(opts)
	if sess.ID == "" {
		if err == nil {
			err = fmt.Errorf("room did not start")
		}
		return session.Session{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.rooms[id]
	if current == nil || current.svc != svc {
		return sess, err
	}
	delete(m.rooms, id)
	current.keyName = key
	m.rooms[sess.ID] = current
	for i, oid := range m.order {
		if oid == id {
			m.order[i] = sess.ID
			break
		}
	}
	if m.focus == id {
		m.focus = sess.ID
	}
	return sess, err
}

func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	slot := m.rooms[id]
	if slot == nil {
		m.mu.Unlock()
		return ErrUnknownRoom
	}
	delete(m.rooms, id)
	next := make([]string, 0, len(m.order))
	for _, oid := range m.order {
		if oid != id {
			next = append(next, oid)
		}
	}
	m.order = next
	if m.focus == id {
		if len(m.order) > 0 {
			m.focus = m.order[0]
		} else {
			m.focus = ""
			m.lobby = true
		}
	}
	cancel := slot.cancel
	svc := slot.svc
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return svc.Stop()
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := append([]string(nil), m.order...)
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Stop(id)
	}
}

func (m *Manager) Sessions() []session.Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]session.Session, 0, len(m.rooms))
	for _, slot := range m.rooms {
		if sess, ok := slot.svc.Session(); ok {
			out = append(out, sess)
		}
	}
	return out
}

func (m *Manager) Messages(id string) ([]Message, error) {
	svc, err := m.service(id)
	if err != nil {
		return nil, err
	}
	return svc.Messages(), nil
}

func (m *Manager) Peer(id string) (string, error) {
	svc, err := m.service(id)
	if err != nil {
		return "", err
	}
	return svc.Peer(), nil
}

func (m *Manager) Connect(id, addr string) error {
	svc, err := m.service(id)
	if err != nil {
		return err
	}
	return svc.Connect(addr)
}

func (m *Manager) SendText(id, body string, burn bool, ttlSec int) error {
	svc, err := m.service(id)
	if err != nil {
		return err
	}
	return svc.SendTextBurn(body, burn, ttlSec)
}

func (m *Manager) SendFile(id, path string, burn bool, ttlSec int) (string, error) {
	svc, err := m.service(id)
	if err != nil {
		return "", err
	}
	return svc.SendFile(path, burn, ttlSec)
}

func (m *Manager) SendVoice(id, mime string, durationSec int, audio []byte, burn bool, ttlSec int) error {
	svc, err := m.service(id)
	if err != nil {
		return err
	}
	return svc.SendVoice(mime, durationSec, audio, burn, ttlSec)
}

func (m *Manager) SendSignal(id, metaJSON string) error {
	svc, err := m.service(id)
	if err != nil {
		return err
	}
	return svc.SendSignal(metaJSON)
}

func (m *Manager) Discard(id, messageID string) error {
	svc, err := m.service(id)
	if err != nil {
		return err
	}
	return svc.Discard(messageID)
}

func (m *Manager) Resend(id, messageID string) error {
	svc, err := m.service(id)
	if err != nil {
		return err
	}
	_, err = svc.Resend(messageID)
	return err
}

func (m *Manager) FileName(id, messageID string) (string, error) {
	svc, err := m.service(id)
	if err != nil {
		return "", err
	}
	return svc.FileName(messageID), nil
}

func (m *Manager) CopyFile(id, messageID, dest string) error {
	svc, err := m.service(id)
	if err != nil {
		return err
	}
	return svc.CopyFile(messageID, dest)
}

func (m *Manager) service(id string) (*Service, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	slot := m.rooms[id]
	if slot == nil {
		return nil, ErrUnknownRoom
	}
	return slot.svc, nil
}

func (m *Manager) watch(ctx context.Context, svc *Service) {
	ch := svc.Events()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			select {
			case m.events <- ev:
			default:
			}
		}
	}
}

// sweepDataRoot clears the legacy shared inbox and any room directories left by a crash.
func sweepDataRoot(root string) {
	if root == "" {
		return
	}
	_ = sweepChatDir(root, inboxDirName)
	_ = sweepChatDir(root, partialDirName)
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if name == inboxDirName || name == partialDirName {
			continue
		}
		_ = os.RemoveAll(filepath.Join(root, name))
	}
}
