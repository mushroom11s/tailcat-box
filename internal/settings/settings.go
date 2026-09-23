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

// UpdateState is the last in-app update check persisted for Settings.
type UpdateState struct {
	CheckedAt      time.Time
	LatestTag      string
	LatestVersion  string
	ReleaseURL     string
	Notes          string
	AssetName      string
	DownloadURL    string
	DownloadedPath string
	Status         string
	Error          string
}

type updateRecord struct {
	LatestTag      string `json:"LatestTag,omitempty"`
	LatestVersion  string `json:"LatestVersion,omitempty"`
	ReleaseURL     string `json:"ReleaseURL,omitempty"`
	Notes          string `json:"Notes,omitempty"`
	AssetName      string `json:"AssetName,omitempty"`
	DownloadURL    string `json:"DownloadURL,omitempty"`
	DownloadedPath string `json:"DownloadedPath,omitempty"`
	Status         string `json:"Status,omitempty"`
	Error          string `json:"Error,omitempty"`
}

type fileRecord struct {
	LaunchAtLogin   bool          `json:"LaunchAtLogin"`
	LastUpdateCheck string        `json:"LastUpdateCheck,omitempty"`
	Update          *updateRecord `json:"Update,omitempty"`
}

// Store persists desktop-client settings beside the key store.
type Store struct {
	mu              sync.Mutex
	dir             string
	LaunchAtLogin   bool
	LastUpdateCheck time.Time
	update          UpdateState
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
	if rec.Update != nil {
		s.update = UpdateState{
			LatestTag:      rec.Update.LatestTag,
			LatestVersion:  rec.Update.LatestVersion,
			ReleaseURL:     rec.Update.ReleaseURL,
			Notes:          rec.Update.Notes,
			AssetName:      rec.Update.AssetName,
			DownloadURL:    rec.Update.DownloadURL,
			DownloadedPath: rec.Update.DownloadedPath,
			Status:         rec.Update.Status,
			Error:          rec.Update.Error,
		}
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

// UpdateState returns the persisted update check, including the last-checked time.
func (s *Store) UpdateState() UpdateState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.update
	st.CheckedAt = s.LastUpdateCheck
	return st
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

// SetUpdateState stores the latest check and, when CheckedAt is set, the 24 hour clock.
func (s *Store) SetUpdateState(st UpdateState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !st.CheckedAt.IsZero() {
		s.LastUpdateCheck = st.CheckedAt.UTC()
	}
	st.CheckedAt = time.Time{}
	s.update = st
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
	if urec := s.update.record(); urec != nil {
		rec.Update = urec
	}
	body, err := json.MarshalIndent(rec, "", "\t")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(), append(body, '\n'), 0o600)
}

func (st UpdateState) record() *updateRecord {
	rec := &updateRecord{
		LatestTag:      st.LatestTag,
		LatestVersion:  st.LatestVersion,
		ReleaseURL:     st.ReleaseURL,
		Notes:          st.Notes,
		AssetName:      st.AssetName,
		DownloadURL:    st.DownloadURL,
		DownloadedPath: st.DownloadedPath,
		Status:         st.Status,
		Error:          st.Error,
	}
	if *rec == (updateRecord{}) {
		return nil
	}
	return rec
}
