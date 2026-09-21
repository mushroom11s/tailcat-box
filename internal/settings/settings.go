package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const fileName = "settings.json"

// New returns an empty store rooted at dir.
func New(dir string) *Store {
	return &Store{dir: dir}
}

type fileRecord struct {
	LaunchAtLogin   bool   `json:"LaunchAtLogin"`
	LastUpdateCheck string `json:"LastUpdateCheck,omitempty"`
}

// Store persists desktop-client settings beside the key store.
type Store struct {
	mu              sync.Mutex
	dir             string
	LaunchAtLogin   bool
	LastUpdateCheck time.Time
}

// Load reads settings.json from dir, or returns defaults if the file is missing.
func Load(dir string) (*Store, error) {
	s := &Store{dir: dir}
	body, err := os.ReadFile(s.path())
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	var rec fileRecord
	if err := json.Unmarshal(body, &rec); err != nil {
		return nil, err
	}
	s.LaunchAtLogin = rec.LaunchAtLogin
	if rec.LastUpdateCheck != "" {
		parsed, err := time.Parse(time.RFC3339, rec.LastUpdateCheck)
		if err != nil {
			return nil, err
		}
		s.LastUpdateCheck = parsed
	}
	return s, nil
}

func (s *Store) path() string {
	return filepath.Join(s.dir, fileName)
}

// Snapshot returns the current launch-at-login flag and last update-check time.
func (s *Store) Snapshot() (launchAtLogin bool, lastUpdateCheck time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.LaunchAtLogin, s.LastUpdateCheck
}

// SetLaunchAtLogin updates the persisted launch-at-login preference.
func (s *Store) SetLaunchAtLogin(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LaunchAtLogin = enabled
	return s.saveLocked()
}

// SetLastUpdateCheck records when a Tailcat version inspection last ran.
func (s *Store) SetLastUpdateCheck(when time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LastUpdateCheck = when.UTC()
	return s.saveLocked()
}

func (s *Store) saveLocked() error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	rec := fileRecord{LaunchAtLogin: s.LaunchAtLogin}
	if !s.LastUpdateCheck.IsZero() {
		rec.LastUpdateCheck = s.LastUpdateCheck.UTC().Format(time.RFC3339)
	}
	body, err := json.MarshalIndent(rec, "", "\t")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(), append(body, '\n'), 0o600)
}
