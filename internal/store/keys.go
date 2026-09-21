package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const keySuffix = ".private.json"

type KeyInfo struct {
	Name    string
	Path    string
	Client  bool
	Address string
	Source  string // "app" or "cli"
}

type CreateOpts struct {
	Client bool
	Region string
}

type fileRecord struct {
	Name    string `json:"Name"`
	Client  bool   `json:"Client"`
	Region  string `json:"Region,omitempty"`
	Address string `json:"Address"`
}

type Store struct {
	Dir      string
	ExtraDir string
}

func New(dir string) *Store {
	return &Store{Dir: dir}
}

func (s *Store) List() ([]KeyInfo, error) {
	var out []KeyInfo
	app, err := s.listDir(s.Dir, "app")
	if err != nil {
		return nil, err
	}
	out = append(out, app...)
	if s.ExtraDir != "" {
		cli, err := s.listDir(s.ExtraDir, "cli")
		if err != nil {
			return nil, err
		}
		seen := map[string]bool{}
		for _, k := range out {
			seen[k.Name] = true
		}
		for _, k := range cli {
			if seen[k.Name] {
				continue
			}
			out = append(out, k)
		}
	}
	return out, nil
}

func (s *Store) Create(name string, opts CreateOpts) (string, error) {
	if err := validateName(name); err != nil {
		return "", err
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(s.Dir, name+keySuffix)
	if _, err := os.Stat(path); err == nil {
		return "", fmt.Errorf("key %q already exists", name)
	}
	addr := "tc:local-" + name
	if opts.Client {
		addr = "nodekey:" + name
	}
	rec := fileRecord{
		Name:    name,
		Client:  opts.Client,
		Region:  opts.Region,
		Address: addr,
	}
	body, err := json.MarshalIndent(rec, "", "\t")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, append(body, '\n'), 0o600); err != nil {
		return "", err
	}
	return addr, nil
}

func (s *Store) Delete(name string) error {
	if err := validateName(name); err != nil {
		return err
	}
	path := filepath.Join(s.Dir, name+keySuffix)
	if err := os.Remove(path); err != nil {
		return err
	}
	return nil
}

func (s *Store) listDir(dir, source string) ([]KeyInfo, error) {
	ents, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]KeyInfo, 0, len(ents))
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		name, ok := strings.CutSuffix(e.Name(), keySuffix)
		if !ok {
			continue
		}
		path := filepath.Join(dir, e.Name())
		info := KeyInfo{Name: name, Path: path, Source: source}
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var rec fileRecord
		if json.Unmarshal(body, &rec) == nil {
			if rec.Name != "" {
				info.Name = rec.Name
			}
			info.Client = rec.Client
			info.Address = rec.Address
		}
		out = append(out, info)
	}
	return out, nil
}

func validateName(name string) error {
	if name == "" {
		return fmt.Errorf("key name is required")
	}
	if strings.Contains(name, "/") || strings.Contains(name, `\`) || strings.Contains(name, "..") {
		return fmt.Errorf("invalid key name %q", name)
	}
	if filepath.Base(name) != name {
		return fmt.Errorf("invalid key name %q", name)
	}
	return nil
}
