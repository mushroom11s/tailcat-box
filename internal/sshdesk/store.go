package sshdesk

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const fileName = "ssh.json"

// Peer is a saved device whose Tailcat address supplies a node key.
type Peer struct {
	Name    string `json:"name,omitempty"`
	Address string `json:"address"`
}

// State is the persisted Allow SSH desk. Enabled defaults to false.
type State struct {
	Enabled      bool   `json:"enabled"`
	AllowAny     bool   `json:"allowAny"`
	Address      string `json:"address,omitempty"`
	Peers        []Peer `json:"peers,omitempty"`
	IdentityJSON string `json:"identity,omitempty"`
}

// Store persists ssh.json beside the other desktop settings.
type Store struct {
	dir string
}

func New(dir string) *Store {
	return &Store{dir: dir}
}

func (s *Store) path() string {
	return filepath.Join(s.dir, fileName)
}

// Load reads ssh.json. A missing file is the default: SSH off, allowlist mode.
func Load(dir string) (*Store, State, error) {
	s := New(dir)
	st, err := s.Load()
	return s, st, err
}

func (s *Store) Load() (State, error) {
	body, err := os.ReadFile(s.path())
	if err != nil {
		if os.IsNotExist(err) {
			return State{}, nil
		}
		return State{}, err
	}
	var st State
	if err := json.Unmarshal(body, &st); err != nil {
		return State{}, err
	}
	st.Peers = normalizePeers(st.Peers)
	st.Address = strings.TrimSpace(st.Address)
	return st, nil
}

func (s *Store) Save(st State) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	st.Peers = normalizePeers(st.Peers)
	st.Address = strings.TrimSpace(st.Address)
	body, err := json.MarshalIndent(st, "", "\t")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(), append(body, '\n'), 0o600)
}

func normalizePeers(in []Peer) []Peer {
	if len(in) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]Peer, 0, len(in))
	for _, p := range in {
		addr := strings.TrimSpace(p.Address)
		if addr == "" || seen[addr] {
			continue
		}
		seen[addr] = true
		out = append(out, Peer{Name: strings.TrimSpace(p.Name), Address: addr})
	}
	return out
}
